import { z } from "zod";
import { defineTool } from "./define";
import { reachableItem } from "./items";
import { isError, ok } from "./result";
import { newestFirst, selectAllItems, toItem } from "./rows";
import { describePlace, loadScope, reachOf, resolveReadPlace, type ReadPlace } from "./tree";

// The notes of a place: what someone wants to keep in view without it being something to do. A decision is a note marked
// as one.

export const noteRowSchema = z.object({
  id: z.string(),
  // The note's first line, as written: a link goes over its words, [words](address).
  title: z.string(),
  body: z.string().nullable(),
  decision: z.boolean(),
  // Where it lives: its node and that node's color, or null for a loose note or a general task's.
  nodeId: z.string().nullable(),
  path: z.string().nullable(),
  color: z.string().nullable(),
  // The task it hangs from.
  parentId: z.string().nullable(),
  source: z.enum(["manual", "chat", "agent", "review"]),
  agentLabel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type NoteRow = z.infer<typeof noteRowSchema>;

export const listNotes = defineTool({
  name: "list_notes",
  description:
    "The notes of a place, newest first, each saying whether it is a decision: a node's own and those of everything " +
    "below it, the loose notes of General (node null), or the notes of one task (parent). A note that hangs from a task " +
    "is read with its task, not with its node. Without node or parent, the notes of everything in reach.",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).nullable().optional().describe("A node's id or path, or null for the loose notes of General."),
    parent: z.uuid().optional().describe("A task's id: the notes that hang from it."),
    subtree: z.boolean().default(true).describe("With a node, also the notes of every node below it (the default)."),
    decisionsOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  output: z.object({
    scope: z.object({ kind: z.enum(["all", "general", "node", "task"]), id: z.string().nullable(), path: z.string().nullable() }),
    notes: z.array(noteRowSchema),
    // Every note of the place, whatever the limit let through.
    total: z.number(),
  }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let place: ReadPlace;
    let parent: string | null = null;
    if (input.parent !== undefined) {
      const task = await reachableItem(ctx, input.parent);
      if (isError(task)) return task;
      parent = task.row.id;
      const node = task.row.node_id === null ? null : scope.all.get(task.row.node_id)!;
      place = node ? { kind: "node", node } : { kind: "general" };
    } else {
      const resolved = resolveReadPlace(scope, input.node);
      if (isError(resolved)) return resolved;
      place = resolved.place;
    }
    const read = await selectAllItems(
      ctx,
      reachOf(scope, place, input.subtree || parent !== null),
      (query) => {
        const notes = query.is("deleted_at", null).in("type", input.decisionsOnly ? ["decision"] : ["note", "decision"]);
        return parent ? notes.eq("parent_item_id", parent) : notes.is("parent_item_id", null);
      },
      "reading the notes",
    );
    if (isError(read)) return read;
    const notes = read.rows
      .map((row) => toItem(row, scope))
      .sort(newestFirst)
      .map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        decision: item.type === "decision",
        nodeId: item.nodeId,
        path: item.nodePath,
        color: item.nodeId === null ? null : (scope.all.get(item.nodeId)?.color ?? null),
        parentId: item.parentId,
        source: item.source,
        agentLabel: item.agentLabel,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
    return ok({
      scope: parent ? { kind: "task" as const, id: parent, path: null } : describePlace(place),
      notes: notes.slice(0, input.limit),
      total: notes.length,
    });
  },
});
