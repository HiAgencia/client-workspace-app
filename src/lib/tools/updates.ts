import { z } from "zod";
import { defineTool } from "./define";
import { fail, isError, ok } from "./result";
import { itemSchema, selectAllItems, toItem, type Item } from "./rows";
import { loadScope, resolveNode, subtree } from "./tree";

// Each changed item lands in exactly one list, by the latest thing that happened to it since the moment.
// The database writes microseconds and an offset, the caller milliseconds and a Z: compared as instants, not text.
function after(value: string | null, since: number): boolean {
  return value !== null && Date.parse(value) > since;
}

function classify(item: Item, since: number): "deleted" | "completed" | "created" | "changed" {
  if (after(item.deletedAt, since)) return "deleted";
  if (after(item.completedAt, since)) return "completed";
  if (after(item.createdAt, since)) return "created";
  return "changed";
}

export const getUpdatesSince = defineTool({
  name: "get_updates_since",
  description:
    "What happened in a node and everything below it since a moment: new nodes, and items created, changed, " +
    "completed, or deleted. Without a moment, since this access was last used. Call it first when starting work " +
    "to learn what is new in the project.",
  readOnly: true,
  input: z.object({
    since: z.iso.datetime({ offset: true }).optional().describe("An ISO date-time with its offset."),
    node: z.string().min(1).optional().describe("The node's id or path. Omit it to use the current node."),
  }),
  output: z.object({
    since: z.string(),
    // The latest change read, by the database's clock: the next call passes it as `since` and misses nothing.
    until: z.string(),
    newNodes: z.array(z.object({ id: z.string(), path: z.string(), kind: z.string() })),
    created: z.array(itemSchema),
    changed: z.array(itemSchema),
    completed: z.array(itemSchema),
    deleted: z.array(itemSchema),
  }),
  async run(ctx, input) {
    const sinceValue = input.since ?? ctx.updatesSince;
    if (!sinceValue) return fail("since_required", "say since when: an ISO date-time such as 2026-05-01T09:00:00Z");
    const since = new Date(sinceValue).toISOString();
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let ids = [...scope.reachable];
    if (input.node !== undefined || scope.root) {
      const resolved = resolveNode(scope, input.node);
      if (isError(resolved)) return resolved;
      ids = [...subtree(scope.all, resolved.node.id)].filter((id) => scope.reachable.has(id));
    }
    const read = await selectAllItems(ctx, ids, (query) => query.gt("updated_at", since), "reading what changed");
    if (isError(read)) return read;
    const lists = { created: [] as Item[], changed: [] as Item[], completed: [] as Item[], deleted: [] as Item[] };
    const items = read.rows.map((row) => toItem(row, scope)).sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
    const sinceMs = Date.parse(since);
    for (const item of items) {
      const kind = classify(item, sinceMs);
      // Something created and deleted within the window never existed for the reader.
      if (kind === "deleted" && after(item.createdAt, sinceMs)) continue;
      lists[kind].push(item);
    }
    const newNodes = ids
      .map((id) => scope.all.get(id)!)
      .filter((node) => after(node.createdAt, sinceMs))
      .map((node) => ({ id: node.id, path: node.path, kind: node.kind }));
    const latest = [...items.map((item) => item.updatedAt), ...newNodes.map((n) => scope.all.get(n.id)!.createdAt)]
      .map((value) => Date.parse(value))
      .reduce((max, value) => Math.max(max, value), sinceMs);
    return ok({ since, until: new Date(latest).toISOString(), newNodes, ...lists });
  },
});
