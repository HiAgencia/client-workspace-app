import { z } from "zod";
import { defineTool } from "./define";
import { browsedEventSchema, fromLocal } from "./browse";
import { eventsForNode } from "./events";
import { localEventsIn } from "./local-events";
import { eventsFailureSchema } from "./events-source";
import { isError, ok } from "./result";
import { byPriorityThenDue, countInSubtrees, itemSchema, newestFirst, selectAllItems, toItem } from "./rows";
import { loadScope, resolveNode, subtree } from "./tree";

const DAY_MS = 24 * 60 * 60 * 1000;

const treeNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: z.enum(["client", "project", "subproject"]),
  name: z.string(),
  path: z.string(),
  openTasks: z.number(),
  openReviews: z.number(),
});

export const listTree = defineTool({
  name: "list_tree",
  description:
    "List the tree reachable here (or below one node): clients and the person's own projects at the root, a client's " +
    "projects, and subprojects below a project; each node with its path and what is pending in it and everything below " +
    "it: open tasks (subtasks included) and items to review. Use it to find where something belongs before writing.",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("List only this node and what is below it: its id or path."),
  }),
  output: z.object({ nodes: z.array(treeNodeSchema) }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let ids = [...scope.reachable];
    if (input.node !== undefined) {
      const resolved = resolveNode(scope, input.node);
      if (isError(resolved)) return resolved;
      ids = [...subtree(scope.all, resolved.node.id)].filter((id) => scope.reachable.has(id));
    }
    const read = await selectAllItems(
      ctx,
      ids,
      (query) => query.is("deleted_at", null).eq("status", "open").in("type", ["task", "review"]),
      "counting open items",
    );
    if (isError(read)) return read;
    // A node's numbers are what is pending in its whole subtree —open tasks, subtasks included, and open things to
    // review—, counted by the same walk as the board's figures.
    const { perNode: counts } = countInSubtrees(read.rows, scope, new Set(ids), ["tasks", "reviews"], (row) => [row.type === "task" ? "tasks" : "reviews"]);
    const nodes = ids
      .map((id) => scope.all.get(id)!)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((node) => ({
        id: node.id,
        parentId: node.parentId,
        kind: node.kind,
        name: node.name,
        path: node.path,
        openTasks: counts.get(node.id)?.tasks ?? 0,
        openReviews: counts.get(node.id)?.reviews ?? 0,
      }));
    return ok({ nodes });
  },
});

export const getOverview = defineTool({
  name: "get_overview",
  description:
    "Everything that matters in one node: its open tasks by priority (subtasks say their parentId), the notes, recent " +
    "decisions, and links of the node and of everything below it (each with its nodePath), what the nodes below hold " +
    "(below), open things to review, its subprojects, and the events of the next seven days from its accounts. Start " +
    "here to answer what is pending or to advise on what to do next.",
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
    links: z.array(itemSchema),
    toReview: z.array(itemSchema),
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
    const below = [...subtree(scope.all, node.id)].filter((id) => scope.reachable.has(id));
    const [read, subtreeRead] = await Promise.all([
      selectAllItems(ctx, [node.id], (query) => query.is("deleted_at", null), "reading the node"),
      // The node and what is below it: notes, decisions, and links are found from every node above them, and the rest is
      // summed so the node says where its work is.
      selectAllItems(ctx, below, (query) => query.is("deleted_at", null), "reading what is below"),
    ]);
    if (isError(read)) return read;
    if (isError(subtreeRead)) return subtreeRead;
    const items = read.rows.map((row) => toItem(row, scope));
    const kept = (type: "note" | "decision" | "link") =>
      subtreeRead.rows.filter((row) => row.type === type && (type !== "note" || row.parent_item_id === null)).map((row) => toItem(row, scope)).sort(newestFirst);
    const deeper = subtreeRead.rows.filter((row) => row.node_id !== node.id);
    const summary = (type: "task" | "decision" | "review" | "note", open: boolean) => {
      const rows = deeper.filter((row) => row.type === type && (!open || row.status === "open"));
      const where = new Map<string, number>();
      for (const row of rows) where.set(row.node_id, (where.get(row.node_id) ?? 0) + 1);
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
          localEventsIn(ctx, scope, below, new Date(now.getTime() - 14 * 3_600_000).toISOString().slice(0, 10), until.toISOString().slice(0, 10), {
            from: now.toISOString(),
            to: until.toISOString(),
          }),
        ])
      : [{ events: [], failures: [] }, ok({ events: [] })];
    if (isError(local)) return local;
    const failures = google.failures;
    const events = [
      ...google.events.map((event) => ({ ...event, origin: "google" as const, localId: null, nodeId: null, nodePath: null })),
      ...local.events.map(fromLocal),
    ].sort((a, b) => Date.parse(a.allDay ? `${a.start}T00:00:00` : a.start) - Date.parse(b.allDay ? `${b.start}T00:00:00` : b.start));
    return ok({
      node: { id: node.id, path: node.path, kind: node.kind },
      children: [...scope.all.values()]
        .filter((child) => child.parentId === node.id && scope.reachable.has(child.id))
        .map((child) => ({ id: child.id, name: child.name })),
      openTasks: items.filter((item) => item.type === "task" && item.status === "open").sort(byPriorityThenDue),
      // A note hanging from a task is the task's: it reads in the task's details, not here.
      notes: kept("note").slice(0, 20),
      decisions: kept("decision").slice(0, 10),
      links: kept("link").slice(0, 30),
      below: {
        openTasks: summary("task", true),
        notes: summary("note", false),
        decisions: summary("decision", false),
        toReview: summary("review", true),
      },
      toReview: items.filter((item) => item.type === "review" && item.status === "open").sort(newestFirst),
      events,
      eventFailures: failures,
    });
  },
});
