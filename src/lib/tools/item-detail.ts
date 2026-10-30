import { z } from "zod";
import { mailFailureSchema } from "@/lib/mail/source";
import { defineTool } from "./define";
import { reachableItem } from "./items";
import { EVENT_COLUMNS, localEventSchema, taskEventLinks, taskEventSchema, toLocalEvent } from "./local-events";
import { itemMailOf } from "./mail";
import { mailRowSchema, taskMailSchema } from "./mail-schema";
import { taskMailOf } from "./waits";
import { noteRowSchema } from "./notes";
import { dbFail, isError, ok } from "./result";
import { itemSchema, newestFirst, selectAllItems, toItem } from "./rows";
import { rowOf, taskRowSchema } from "./tasks";
import { reaches } from "./tree";

// One item and everything its detail shows, in one read: the item where it lives, its parent, its subtasks as rows, its
// notes, the event it is in, the mail it waits for, and the messages linked to it.

export const itemDetailOutput = z.object({
  // The item as the other tools give it, with the color its place shows (null for General).
  item: itemSchema.extend({ color: z.string().nullable() }),
  // The task it hangs from, for a subtask or a task's note.
  parent: z.object({ id: z.string(), title: z.string(), status: z.enum(["open", "done"]) }).nullable(),
  // Its subtasks, first to last in the manual order, each as its row shows it.
  subtasks: z.array(taskRowSchema),
  // Its notes and decisions, newest first.
  notes: z.array(noteRowSchema),
  // The event it is in: the workspace's own, with its moment, or a Google one by its ids.
  event: z.object({ link: taskEventSchema, event: localEventSchema.nullable() }).nullable(),
  // What it waits for, and the messages linked to it; its possible replies are read apart (list_task_replies).
  mail: taskMailSchema.nullable(),
  messages: z.array(mailRowSchema),
  mailFailures: z.array(mailFailureSchema),
});

export const getItem = defineTool({
  name: "get_item",
  description:
    "One item by id with what its detail shows: where it lives, its parent task, its subtasks with their counts, its " +
    "notes and decisions, the event it is in, what mail it waits for, and the messages linked to it.",
  readOnly: true,
  input: z.strictObject({ id: z.uuid() }),
  output: itemDetailOutput,
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.id);
    if (isError(found)) return found;
    const { row, scope } = found;
    const node = row.node_id === null ? null : scope.all.get(row.node_id);

    // What hangs from it and from its subtasks lives where it lives: one read of its place gives the counts too.
    const place = await selectAllItems(ctx, { nodeIds: row.node_id ? [row.node_id] : [], general: row.node_id === null }, (query) => query.is("deleted_at", null), "reading what hangs from the item");
    if (isError(place)) return place;
    const counts = new Map<string, { done: number; total: number; notes: number }>();
    for (const child of place.rows) {
      if (!child.parent_item_id) continue;
      const count = counts.get(child.parent_item_id) ?? { done: 0, total: 0, notes: 0 };
      if (child.type === "task") {
        count.total++;
        if (child.status === "done") count.done++;
      } else count.notes++;
      counts.set(child.parent_item_id, count);
    }
    const children = place.rows.filter((child) => child.parent_item_id === row.id);
    const subtaskRows = children.filter((child) => child.type === "task").sort((a, b) => Number(a.position) - Number(b.position) || (a.created_at < b.created_at ? -1 : 1));
    const waits = await taskMailOf(ctx, [row.id, ...subtaskRows.map((child) => child.id)]);
    if (isError(waits)) return waits;

    let parent: z.infer<typeof itemDetailOutput>["parent"] = null;
    if (row.parent_item_id) {
      const above = place.rows.find((entry) => entry.id === row.parent_item_id);
      if (above) parent = { id: above.id, title: above.title, status: above.status };
    }

    const notes = children
      .filter((child) => child.type === "note" || child.type === "decision")
      .map((child) => toItem(child, scope))
      .sort(newestFirst)
      .map((note) => ({
        id: note.id,
        title: note.title,
        body: note.body,
        decision: note.type === "decision",
        nodeId: note.nodeId,
        path: note.nodePath,
        color: node?.color ?? null,
        parentId: note.parentId,
        source: note.source,
        agentLabel: note.agentLabel,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      }));

    let event: z.infer<typeof itemDetailOutput>["event"] = null;
    if (row.type === "task") {
      const links = await taskEventLinks(ctx, { itemIds: [row.id] });
      if (isError(links)) return links;
      const link = links.links[0];
      if (link) {
        let own = null;
        if (link.eventId) {
          const { data, error } = await ctx.db.from("events").select(EVENT_COLUMNS).eq("id", link.eventId).eq("owner_id", ctx.ownerId).maybeSingle();
          if (error) return dbFail("reading the item's event", error);
          if (data && !data.deleted_at && reaches(scope, ctx.ownerId, data)) own = toLocalEvent(data, scope);
        }
        event = { link, event: own };
      }
    }

    const mail = waits.byTask.get(row.id) ?? null;
    const messages = await itemMailOf(ctx, scope, row.id);
    if (isError(messages)) return messages;

    return ok({
      item: { ...toItem(row, scope), color: node?.color ?? null },
      parent,
      subtasks: subtaskRows.map((child) => rowOf(child, scope, counts, waits.byTask)),
      notes,
      event,
      mail,
      messages: messages.rows,
      mailFailures: messages.failures,
    });
  },
});
