import { z } from "zod";
import { defineTool } from "./define";
import { eventsForNode } from "./events";
import { calendarEventSchema, eventsFailureSchema } from "./events-source";
import { isError, ok } from "./result";
import { byPriorityThenDue, itemSchema, newestFirst, selectAllItems, toItem } from "./rows";
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
    "List the client → project → subproject tree reachable here (or below one node), each node with its path and " +
    "its open tasks and things to review. Use it to find where something belongs before writing.",
  readOnly: true,
  input: z.object({
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
    const counts = new Map<string, { tasks: number; reviews: number }>();
    for (const row of read.rows) {
      const count = counts.get(row.node_id) ?? { tasks: 0, reviews: 0 };
      if (row.type === "task") count.tasks++;
      else count.reviews++;
      counts.set(row.node_id, count);
    }
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
    "Everything that matters in one node: its open tasks by priority, recent decisions, links, open things to " +
    "review, its subprojects, and the events of the next seven days from its accounts. Start here to answer what " +
    "is pending or to advise on what to do next.",
  readOnly: true,
  input: z.object({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it to use the current node."),
  }),
  output: z.object({
    node: z.object({ id: z.string(), path: z.string(), kind: z.string() }),
    children: z.array(z.object({ id: z.string(), name: z.string() })),
    openTasks: z.array(itemSchema),
    decisions: z.array(itemSchema),
    links: z.array(itemSchema),
    toReview: z.array(itemSchema),
    events: z.array(calendarEventSchema),
    eventFailures: z.array(eventsFailureSchema),
  }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    const resolved = resolveNode(scope, input.node);
    if (isError(resolved)) return resolved;
    const node = resolved.node;
    const read = await selectAllItems(ctx, [node.id], (query) => query.is("deleted_at", null), "reading the node");
    if (isError(read)) return read;
    const items = read.rows.map((row) => toItem(row, scope));
    const now = new Date();
    const { events, failures } = await eventsForNode(
      ctx,
      node,
      now.toISOString(),
      new Date(now.getTime() + 7 * DAY_MS).toISOString(),
    );
    return ok({
      node: { id: node.id, path: node.path, kind: node.kind },
      children: [...scope.all.values()]
        .filter((child) => child.parentId === node.id && scope.reachable.has(child.id))
        .map((child) => ({ id: child.id, name: child.name })),
      openTasks: items.filter((item) => item.type === "task" && item.status === "open").sort(byPriorityThenDue),
      decisions: items.filter((item) => item.type === "decision").sort(newestFirst).slice(0, 10),
      links: items.filter((item) => item.type === "link").sort(newestFirst).slice(0, 20),
      toReview: items.filter((item) => item.type === "review" && item.status === "open").sort(newestFirst),
      events,
      eventFailures: failures,
    });
  },
});
