import { z } from "zod";
import { NODE_COLORS } from "@/lib/node-colors";
import { defineTool } from "./define";
import { browsedEventSchema, daysOfRange, fromGoogle, fromLocal, inTimeOrder, readCalendars } from "./events";
import { localEventsIn, type LocalEvent } from "./local-events";
import { eventsFailureSchema, type CalendarEvent, type EventsFailure } from "./events-source";
import { dbFail, isError, ok } from "./result";
import { byPriorityThenDue, countInSubtrees, itemSchema, newestFirst, selectAllItems, toItem } from "./rows";
import { accountMap, type AccountMap } from "./mail";
import { groupOf, shownAsRow } from "./tasks";
import { loadScope, reachOf, reaches, resolveNode, subtree, type ReadPlace, type Scope } from "./tree";
import type { Database } from "@/lib/db/types";
import type { ToolContext } from "./context";

type ItemRow = Database["public"]["Tables"]["items"]["Row"];
type TaskMailRow = Database["public"]["Tables"]["task_mail"]["Row"];

const DAY_MS = 24 * 60 * 60 * 1000;

const treeNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: z.enum(["client", "project", "subproject"]),
  name: z.string(),
  path: z.string(),
  
  openTasks: z.number(),
  
  color: z.enum(NODE_COLORS).nullable(),
  ownColor: z.enum(NODE_COLORS).nullable(),
});

const reachedAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  isDemo: z.boolean(),
  status: z.string(),
  
  nodeId: z.string().nullable(),
  nodeIds: z.array(z.string()),
});

const waitingTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  nodeId: z.string().nullable(),
  path: z.string().nullable(),
  color: z.enum(NODE_COLORS).nullable(),
  accountId: z.string().nullable(),
  waitsFor: z.string(),
});


async function mailSourcesOf(ctx: ToolContext, scope: Scope) {
  const [mapped, waited] = await Promise.all([accountMap(ctx, scope), ctx.db.from("task_mail").select("item_id, account_id, waits_for").eq("owner_id", ctx.ownerId)]);
  if (isError(mapped)) return mapped;
  if (waited.error) return dbFail("reading what the tasks wait for", waited.error);
  return ok({ map: mapped.map, waits: waited.data });
}

type MailSources = { map: AccountMap; waits: Array<Pick<TaskMailRow, "item_id" | "account_id" | "waits_for">> };


function mailIndexOf(sources: MailSources, scope: Scope, place: ReadPlace, open: ItemRow[]) {
  const { map } = sources;
  const seen = place.kind === "node" ? map.seenFrom(place.node.id) : null;
  const accounts = [...map.accounts.values()]
    .filter((account) => !seen || seen.has(account.id))

    .map(({ id, email, isDemo, status, nodeId }) => ({ id, email, isDemo, status, nodeId: nodeId && scope.reachable.has(nodeId) ? nodeId : null, nodeIds: (map.hangsFrom.get(id) ?? []).filter((node) => scope.reachable.has(node)) }));
  const waits = new Map(sources.waits.map((row) => [row.item_id, row]));
  const waiting = open
    .filter((row) => waits.has(row.id) && shownAsRow(row))

    .sort((a, b) => (a.due_on ?? "9999") < (b.due_on ?? "9999") ? -1 : (a.due_on ?? "9999") > (b.due_on ?? "9999") ? 1 : 0)
    .map((row) => {
      const node = row.node_id ? scope.all.get(row.node_id) : undefined;
      const wait = waits.get(row.id)!;
      return { id: row.id, title: row.title, nodeId: row.node_id, path: node?.path ?? null, color: node?.color ?? null, accountId: wait.account_id, waitsFor: wait.waits_for };
    });
  return { accounts, waiting };
}


async function notePlacesOf(ctx: ToolContext, scope: Scope, place: ReadPlace) {
  const { data, error } = await ctx.db.from("items").select("node_id, owner_id").eq("owner_id", ctx.ownerId).eq("type", "note").is("deleted_at", null);
  if (error) return dbFail("reading where the notes are", error);
  const holds = new Set<string>();
  let general = false;
  for (const note of data) {
    if (!reaches(scope, ctx.ownerId, note)) continue;
    if (note.node_id === null) general = true;
    for (let cursor = note.node_id ? scope.all.get(note.node_id) : undefined, depth = 0; cursor && depth < 64; depth++) {
      holds.add(cursor.id);
      cursor = cursor.parentId ? scope.all.get(cursor.parentId) : undefined;
    }
  }
  const inPlace = new Set(reachOf(scope, place).nodeIds);
  return ok({ nodes: [...holds].filter((id) => inPlace.has(id)), general: general && place.kind === "all" });
}

export const listTree = defineTool({
  name: "list_tree",
  description:
    "List the tree reachable here (or below one node): clients and the person's own projects at the root, a client's " +
    "projects, and subprojects below a project; each node with its path, its color, and its open tasks with those of " +
    "everything below it. With the person's day, also how many tasks are overdue and due today over everything in " +
    "reach. Use it to find where something belongs before writing.",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("List only this node and what is below it: its id or path."),
    today: z.iso.date().optional().describe("The person's calendar day, to count what is overdue and due today."),
    withMail: z.boolean().default(false).describe("Also say the accounts in reach, and the open tasks that wait for mail. Reads no mail."),
    withNotes: z.boolean().default(false).describe("Also say which places hold a note."),
  }),
  output: z.object({
    nodes: z.array(treeNodeSchema),
    
    tasks: z.object({ overdue: z.number(), today: z.number() }).nullable(),
    
    generalTasks: z.number(),
    
    
    mail: z.object({ accounts: z.array(reachedAccountSchema), waiting: z.array(waitingTaskSchema) }).nullable().optional(),
    
    notes: z.object({ nodes: z.array(z.string()), general: z.boolean() }).nullable().optional(),
  }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let place: ReadPlace = scope.root ? { kind: "node", node: scope.root } : { kind: "all" };
    if (input.node !== undefined) {
      const resolved = resolveNode(scope, input.node);
      if (isError(resolved)) return resolved;
      place = { kind: "node", node: resolved.node };
    }
    const reach = reachOf(scope, place);
    
    
    const [read, mailSources, notes] = await Promise.all([
      selectAllItems(ctx, reach, (query) => query.is("deleted_at", null).eq("status", "open").eq("type", "task"), "counting open tasks"),
      input.withMail ? mailSourcesOf(ctx, scope) : null,
      input.withNotes ? notePlacesOf(ctx, scope, place) : null,
    ]);
    if (isError(read)) return read;
    
    
    const { perNode: counts } = countInSubtrees(read.rows, scope, new Set(reach.nodeIds), ["tasks"], (row) => (shownAsRow(row) ? ["tasks"] : []));
    const nodes = reach.nodeIds
      .map((id) => scope.all.get(id)!)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((node) => ({
        id: node.id,
        parentId: node.parentId,
        kind: node.kind,
        name: node.name,
        path: node.path,
        openTasks: counts.get(node.id)?.tasks ?? 0,
        color: node.color,
        ownColor: node.ownColor,
      }));
    const today = input.today;
    const tasks = today
      ? read.rows.reduce(
          (sum, row) => {
            const group = groupOf(row, today);
            if (group === "overdue") sum.overdue++;
            if (group === "today") sum.today++;
            return sum;
          },
          { overdue: 0, today: 0 },
        )
      : null;
    const generalTasks = read.rows.filter((row) => row.node_id === null && shownAsRow(row)).length;
    if (mailSources && isError(mailSources)) return mailSources;
    const mail = mailSources ? mailIndexOf(mailSources, scope, place, read.rows) : null;
    if (notes && isError(notes)) return notes;
    return ok({
      nodes,
      tasks,
      generalTasks,
      mail: mail ? { accounts: mail.accounts, waiting: mail.waiting } : null,
      notes: notes ? { nodes: notes.nodes, general: notes.general } : null,
    });
  },
});

export const getOverview = defineTool({
  name: "get_overview",
  description:
    "Everything that matters in one node: its open tasks by priority (subtasks say their parentId), the latest notes " +
    "and decisions of the node and of everything below it (each with its nodePath; totals says how many there are in " +
    "all), what the nodes below hold (below), its subprojects, and the events of the next seven days: the workspace's own, " +
    "the sample accounts', and a lone connected account's, except in the chat, which reads no connected account here; over " +
    "several connected accounts it reads none of them. A connected account it did not read is listed in eventsToRead, and " +
    "list_events reads each with its own call. Start here to answer what is pending in a node or to advise on what to do next.",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it to use the current node."),
    withEvents: z.boolean().default(true).describe("Read the next seven days of events too (the default)."),
  }),
  output: z.object({
    node: z.object({ id: z.string(), path: z.string(), kind: z.string() }),
    children: z.array(z.object({ id: z.string(), name: z.string() })),
    openTasks: z.array(itemSchema),
    notes: z.array(itemSchema),
    decisions: z.array(itemSchema),
    
    totals: z.object({ notes: z.number(), decisions: z.number() }),
    events: z.array(browsedEventSchema),
    
    eventsToRead: z.array(z.string()),
    eventFailures: z.array(eventsFailureSchema),
    
    
    below: z.record(z.string(), z.object({ count: z.number(), busiest: z.object({ id: z.string(), path: z.string() }).nullable() })),
  }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    const resolved = resolveNode(scope, input.node);
    if (isError(resolved)) return resolved;
    const node = resolved.node;
    
    
    const below = [...subtree(scope.all, node.id)].filter((id) => scope.reachable.has(id));
    const subtreeRead = await selectAllItems(ctx, { nodeIds: below, general: false }, (query) => query.is("deleted_at", null), "reading the node and what is below");
    if (isError(subtreeRead)) return subtreeRead;
    
    const kept = (row: { type: string; parent_item_id: string | null }, type: "task" | "note" | "decision") =>
      row.type === type && (type !== "note" || row.parent_item_id === null);
    const items = subtreeRead.rows.filter((row) => row.node_id === node.id).map((row) => toItem(row, scope));
    const latest = (type: "note" | "decision") => subtreeRead.rows.filter((row) => kept(row, type)).map((row) => toItem(row, scope)).sort(newestFirst);
    const deeper = subtreeRead.rows.filter((row) => row.node_id !== node.id);
    const summary = (type: "task" | "decision" | "note", open: boolean) => {
      const rows = deeper.filter((row) => kept(row, type) && (!open || row.status === "open"));
      const where = new Map<string, number>();
      
      for (const row of rows) where.set(row.node_id!, (where.get(row.node_id!) ?? 0) + 1);
      const top = [...where.entries()].sort((a, b) => b[1] - a[1])[0];
      return { count: rows.length, busiest: top ? { id: top[0], path: scope.all.get(top[0])?.path ?? "" } : null };
    };
    const now = new Date();
    const until = new Date(now.getTime() + 7 * DAY_MS);
    
    
    const range = { from: now.toISOString(), to: until.toISOString() };
    const { fromDay, toDay } = daysOfRange(now, until);
    const [google, local] = input.withEvents
      ? await Promise.all([
          readCalendars(ctx, scope, { kind: "node", node }, range),
          localEventsIn(ctx, scope, { nodeIds: below, general: false }, fromDay, toDay, range),
        ])
      : [ok({ toRead: [] as string[], events: [] as CalendarEvent[], failures: [] as EventsFailure[] }), ok({ events: [] as LocalEvent[] })];
    if (isError(google)) return google;
    if (isError(local)) return local;
    const events = inTimeOrder([...google.events.map(fromGoogle), ...local.events.map(fromLocal)]);
    const [notes, decisions] = [latest("note"), latest("decision")];
    return ok({
      node: { id: node.id, path: node.path, kind: node.kind },
      children: [...scope.all.values()]
        .filter((child) => child.parentId === node.id && scope.reachable.has(child.id))
        .map((child) => ({ id: child.id, name: child.name })),
      openTasks: items.filter((item) => item.type === "task" && item.status === "open").sort(byPriorityThenDue),
      notes: notes.slice(0, 20),
      decisions: decisions.slice(0, 10),
      totals: { notes: notes.length, decisions: decisions.length },
      below: {
        openTasks: summary("task", true),
        notes: summary("note", false),
        decisions: summary("decision", false),
      },
      events,
      eventsToRead: google.toRead,
      eventFailures: google.failures,
    });
  },
});
