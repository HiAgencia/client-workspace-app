import { z } from "zod";
import { NODE_COLORS } from "@/lib/node-colors";
import { defineTool } from "./define";
import { browseEvents, browsedEventSchema, fromLocal } from "./browse";
import { eventsForNode } from "./events";
import { localEventsIn } from "./local-events";
import { eventsFailureSchema } from "./events-source";
import { dbFail, isError, ok } from "./result";
import { byPriorityThenDue, countInSubtrees, itemSchema, newestFirst, selectAllItems, toItem } from "./rows";
import { accountsOf, mailOf, unreadMail } from "./mail";
import { groupOf, shownAsRow } from "./tasks";
import { loadScope, reachOf, reaches, resolveNode, subtree, type ReadPlace, type Scope } from "./tree";

const DAY_MS = 24 * 60 * 60 * 1000;

const treeNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: z.enum(["client", "project", "subproject"]),
  name: z.string(),
  path: z.string(),
  // Open tasks, subtasks included, of the node and everything below it.
  openTasks: z.number(),
  // The color it shows (its own, or its nearest ancestor's) and the one the person gave it.
  color: z.enum(NODE_COLORS).nullable(),
  ownColor: z.enum(NODE_COLORS).nullable(),
});

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
    withMail: z.boolean().default(false).describe("Also count the unread mail of the accounts in reach."),
    withContent: z
      .strictObject({
        from: z.iso.datetime({ offset: true }).describe("The week's start, an ISO date-time with its offset."),
        to: z.iso.datetime({ offset: true }).describe("The week's end."),
        fromDay: z.iso.date().describe("The person's first calendar day of the week."),
        toDay: z.iso.date().describe("The person's last calendar day of the week (included)."),
      })
      .optional()
      .describe("Also say which places have something to show besides their tasks: mail, notes, or the week's events."),
  }),
  output: z.object({
    nodes: z.array(treeNodeSchema),
    // Over everything the list reaches, General included where reached: what is overdue and due today.
    tasks: z.object({ overdue: z.number(), today: z.number() }).nullable(),
    // With withMail: the unread messages of the accounts in reach (unread in Gmail and not opened here).
    mail: z.object({ unread: z.number() }).nullable().optional(),
    // With withContent: the nodes that have something to show besides their tasks —the mail of an account they see, the
    // notes of what is below them, the week's events of their accounts or of what is below them— and whether General has.
    content: z.object({ nodes: z.array(z.string()), general: z.boolean() }).nullable().optional(),
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
    const read = await selectAllItems(
      ctx,
      reach,
      (query) => query.is("deleted_at", null).eq("status", "open").eq("type", "task"),
      "counting open tasks",
    );
    if (isError(read)) return read;
    // A node's number is what the groups of get_tasks show in its whole subtree: an open task that hangs from no task, and
    // an open subtask with a day; a subtask without one counts inside its task's row. The day's figures count the same.
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
    let mail: { unread: number } | null = null;
    if (input.withMail) {
      const reached = await accountsOf(ctx, scope, place);
      if (isError(reached)) return reached;
      const count = await unreadMail(ctx, reached.accounts);
      if (isError(count)) return count;
      mail = { unread: count.unread };
    }
    if (!input.withContent) return ok({ nodes, tasks, mail, content: null });
    const shown = await contentOf(ctx, scope, place, input.withContent);
    if (isError(shown)) return shown;
    return ok({ nodes, tasks, mail, content: { nodes: shown.nodes, general: shown.general } });
  },
});

// Which places have something to show besides their tasks, read in one request: a place shows the mail of an account it
// sees and the Google events of its accounts, so an account marks the node it hangs from and everything below it; and it
// shows the notes and its own events of what is below it, so a note or an own event marks its node and every ancestor.
async function contentOf(ctx: Parameters<typeof accountsOf>[0], scope: Scope, place: ReadPlace, week: { from: string; to: string; fromDay: string; toDay: string }) {
  const shows = new Set<string>();
  let general = false;
  const up = (id: string | null) => {
    for (let cursor = id ? scope.all.get(id) : undefined, depth = 0; cursor && depth < 64; depth++) {
      shows.add(cursor.id);
      cursor = cursor.parentId ? scope.all.get(cursor.parentId) : undefined;
    }
  };
  const down = (id: string | null) => {
    if (id && scope.all.has(id)) for (const entry of subtree(scope.all, id)) shows.add(entry);
  };
  const reached = await accountsOf(ctx, scope, place);
  if (isError(reached)) return reached;
  const [mail, notes, events] = await Promise.all([
    // The latest message of each account says whether it holds any.
    mailOf(ctx).list({ db: ctx.db, ownerId: ctx.ownerId, accounts: reached.accounts, limit: 1 }),
    ctx.db.from("items").select("node_id, owner_id").eq("owner_id", ctx.ownerId).eq("type", "note").is("deleted_at", null),
    browseEvents.run(ctx, { ...week, node: place.kind === "node" ? place.node.id : undefined }),
  ]);
  if (notes.error) return dbFail("reading where the notes are", notes.error);
  if (isError(events)) return events;
  const withMail = new Set(mail.messages.map((message) => message.accountId));
  for (const account of reached.accounts) if (withMail.has(account.id)) down(account.nodeId);
  for (const note of notes.data) {
    if (!reaches(scope, ctx.ownerId, note)) continue;
    if (note.node_id === null) general = true;
    else up(note.node_id);
  }
  for (const event of events.events) {
    if (event.origin === "local") {
      if (event.nodeId === null && event.linkedNodeIds.length === 0) general = scope.general || general;
      up(event.nodeId);
      for (const id of event.linkedNodeIds) up(id);
    } else down(event.fromNodeId || null);
  }
  const inPlace = new Set(reachOf(scope, place).nodeIds);
  return ok({ nodes: [...shows].filter((id) => inPlace.has(id)), general: general && place.kind === "all" });
}

export const getOverview = defineTool({
  name: "get_overview",
  description:
    "Everything that matters in one node: its open tasks by priority (subtasks say their parentId), the latest notes " +
    "and decisions of the node and of everything below it (each with its nodePath; totals says how many there are in " +
    "all), what the nodes below hold (below), its subprojects, and the events of the next seven days from its accounts. " +
    "Start here to answer what is pending in a node or to advise on what to do next.",
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
    // How many notes and decisions there are: the lists carry the latest ones.
    totals: z.object({ notes: z.number(), decisions: z.number() }),
    events: z.array(browsedEventSchema),
    eventFailures: z.array(eventsFailureSchema),
    // What the nodes below hold, each kind with its count and the node with the most, so an empty node says where the
    // work is.
    below: z.record(z.string(), z.object({ count: z.number(), busiest: z.object({ id: z.string(), path: z.string() }).nullable() })),
  }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    const resolved = resolveNode(scope, input.node);
    if (isError(resolved)) return resolved;
    const node = resolved.node;
    // The subtree holds the node itself: one read gives the node's own work, the notes and decisions found from every
    // node above them, and the sums that say where the rest of its work is.
    const below = [...subtree(scope.all, node.id)].filter((id) => scope.reachable.has(id));
    const subtreeRead = await selectAllItems(ctx, { nodeIds: below, general: false }, (query) => query.is("deleted_at", null), "reading the node and what is below");
    if (isError(subtreeRead)) return subtreeRead;
    // A note hanging from a task is the task's: it reads in the task's details, and neither lists nor counts here.
    const kept = (row: { type: string; parent_item_id: string | null }, type: "task" | "note" | "decision") =>
      row.type === type && (type !== "note" || row.parent_item_id === null);
    const items = subtreeRead.rows.filter((row) => row.node_id === node.id).map((row) => toItem(row, scope));
    const latest = (type: "note" | "decision") => subtreeRead.rows.filter((row) => kept(row, type)).map((row) => toItem(row, scope)).sort(newestFirst);
    const deeper = subtreeRead.rows.filter((row) => row.node_id !== node.id);
    const summary = (type: "task" | "decision" | "note", open: boolean) => {
      const rows = deeper.filter((row) => kept(row, type) && (!open || row.status === "open"));
      const where = new Map<string, number>();
      // Every row of the subtree has its node: the read reaches no General.
      for (const row of rows) where.set(row.node_id!, (where.get(row.node_id!) ?? 0) + 1);
      const top = [...where.entries()].sort((a, b) => b[1] - a[1])[0];
      return { count: rows.length, busiest: top ? { id: top[0], path: scope.all.get(top[0])?.path ?? "" } : null };
    };
    const now = new Date();
    const until = new Date(now.getTime() + 7 * DAY_MS);
    // The agenda: the accounts the node sees and the workspace's own events of its subtree, for the next seven days. A
    // screen that reads its agenda on its own asks without it.
    const [google, local] = input.withEvents
      ? await Promise.all([
          eventsForNode(ctx, node, now.toISOString(), until.toISOString()),
          // The Worker's day is UTC: half a day back reaches today's whole-day events for someone west of it.
          localEventsIn(ctx, scope, { nodeIds: below, general: false }, new Date(now.getTime() - 14 * 3_600_000).toISOString().slice(0, 10), until.toISOString().slice(0, 10), {
            from: now.toISOString(),
            to: until.toISOString(),
          }),
        ])
      : [{ events: [], failures: [] }, ok({ events: [] })];
    if (isError(local)) return local;
    const failures = google.failures;
    const events = [
      ...google.events.map((event) => ({ ...event, origin: "google" as const, localId: null, nodeId: null, nodePath: null, linkedNodeIds: [], linkedTaskIds: [] })),
      ...local.events.map(fromLocal),
    ].sort((a, b) => Date.parse(a.allDay ? `${a.start}T00:00:00` : a.start) - Date.parse(b.allDay ? `${b.start}T00:00:00` : b.start));
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
      eventFailures: failures,
    });
  },
});
