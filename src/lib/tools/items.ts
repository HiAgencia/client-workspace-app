import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { inlineToHtml, writtenBody } from "@/lib/inline-links";
import { noteTitle } from "@/lib/rich-text";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { dbFail, fail, isError, ok, type ToolResult } from "./result";
import { ITEM_COLUMNS, hourOf, itemSchema, itemTypes, selectAllItems, toItem, byPriorityThenDue, newestFirst, type ItemType } from "./rows";
import { dueOn, dueTime, priority, titleText } from "./fields";
import { searchMail } from "./mail";
import { mailRowSchema } from "./mail-schema";
import { loadScope, reachOf, reaches, resolveReadPlace, resolveWritePlace, type Scope } from "./tree";

type ItemInsert = Database["public"]["Tables"]["items"]["Insert"];
type ItemUpdate = Database["public"]["Tables"]["items"]["Update"];
type ItemRow = Database["public"]["Tables"]["items"]["Row"];
type Source = Database["public"]["Enums"]["item_source"];

const nodeRef = z
  .string()
  .min(1)
  .nullable()
  .optional()
  .describe(
    'The node: its id, or its path such as "Acme / Web / Landing"; null for General, the work of no client or project. ' +
      "Omit it to use the current node (General when there is none).",
  );

const parentRef = z
  .uuid()
  .optional()
  .describe("The id of the task it hangs from (a subtask, or a note of that task). Its place is the task's.");

export { dueOn, dueTime, priority, titleText };

const richText = (what: string) =>
  z
    .string()
    .trim()
    .max(20_000)
    .describe(`${what}. Plain text, or HTML with paragraphs, bold, italic, lists, and links; anything else is dropped.`);

export const itemOutput = z.object({ item: itemSchema });

// The writer's mark: every write says where it came from, and an agent's also which token wrote it.
export function origin(ctx: ToolContext): { source: Source; agent_label: string | null } | null {
  if (ctx.source === "agent") {
    return ctx.agentLabel ? { source: "agent", agent_label: ctx.agentLabel } : null;
  }
  return { source: ctx.source, agent_label: null };
}

// Where a new item lands: its parent task's place, or the node named (null for General), or the scope's node (General
// when nothing is scoped). Naming both must agree.
async function placeItem(
  ctx: ToolContext,
  nodeRefValue: string | null | undefined,
  parentId: string | undefined,
): Promise<ToolResult<{ scope: Scope; nodeId: string | null; parentId: string | null }>> {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  if (parentId === undefined) {
    const resolved = resolveWritePlace(loaded.scope, nodeRefValue);
    if (isError(resolved)) return resolved;
    return ok({ scope: loaded.scope, nodeId: resolved.node?.id ?? null, parentId: null });
  }
  const parent = await reachableItem(ctx, parentId);
  if (isError(parent)) return parent;
  if (parent.row.type !== "task") return fail("invalid_input", `a ${parent.row.type} has no children: only a task does`);
  if (nodeRefValue !== undefined) {
    const resolved = resolveWritePlace(loaded.scope, nodeRefValue);
    if (isError(resolved)) return resolved;
    if ((resolved.node?.id ?? null) !== parent.row.node_id) {
      return fail("invalid_input", "the parent task lives in another place: omit the node or name the task's own");
    }
  }
  return ok({ scope: loaded.scope, nodeId: parent.row.node_id, parentId: parent.row.id });
}

export async function insertItem(
  ctx: ToolContext,
  place: { node?: string | null; parent?: string },
  fields: Omit<ItemInsert, "node_id" | "parent_item_id" | "owner_id">,
) {
  const placed = await placeItem(ctx, place.node, place.parent);
  if (isError(placed)) return placed;
  const mark = origin(ctx);
  if (!mark) return fail("internal", "an agent write needs its token's label");
  const { data, error } = await ctx.db
    .from("items")
    .insert({
      ...fields,
      ...mark,
      changed_source: mark.source,
      changed_agent_label: mark.agent_label,
      owner_id: ctx.ownerId,
      node_id: placed.nodeId,
      parent_item_id: placed.parentId,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error) return dbFail("saving the item", error);
  return ok({ item: toItem(data, placed.scope) });
}

// Reads one item the caller may reach; a deleted one only when asked for. A general item is reached only by an access
// that reaches General, and only its owner's.
export async function reachableItem(ctx: ToolContext, id: string, withDeleted = false) {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const { data, error } = await ctx.db.from("items").select(ITEM_COLUMNS).eq("id", id).eq("owner_id", ctx.ownerId).maybeSingle();
  if (error) return dbFail("reading the item", error);
  if (!data || !reaches(loaded.scope, ctx.ownerId, data) || (data.deleted_at && !withDeleted)) {
    return fail("not_found", `no item with id ${id} is reachable here`);
  }
  return ok({ row: data, scope: loaded.scope });
}

export const createTask = defineTool({
  name: "create_task",
  description:
    "Create a task in a node, in General (node null: the work of no client or project), or a subtask under a task " +
    "(parent). Use it for anything someone has to do. Give a short imperative title; put detail in notes. Priority 1 " +
    "is the most urgent and 4 the least (default 4). A due day may carry its hour. Returns the created task.",
  readOnly: false,
  input: z
    .strictObject({
      node: nodeRef,
      parent: parentRef,
      title: titleText,
      notes: richText("Detail of the task").optional(),
      priority: priority.optional(),
      dueOn: dueOn.optional(),
      dueTime: dueTime.optional(),
    })
    .refine((value) => value.dueTime === undefined || value.dueOn !== undefined, { message: "an hour needs its due day (dueOn)" }),
  output: itemOutput,
  run: (ctx, input) =>
    insertItem(ctx, input, {
      type: "task",
      title: input.title,
      body: writtenBody(input.notes),
      priority: input.priority ?? 4,
      due_on: input.dueOn ?? null,
      due_time: input.dueTime ?? null,
    }),
});

export const addNote = defineTool({
  name: "add_note",
  description:
    "Write a note in a node (a client, project, or subproject), under a task (parent), or loose in General (node " +
    "null): meeting notes, what a client said, something to remember that is not something to do. Its first line is " +
    "its title; a link goes over its words, [words](https://address).",
  readOnly: false,
  input: z.strictObject({
    node: nodeRef,
    parent: parentRef,
    text: richText("The note"),
  }),
  output: itemOutput,
  async run(ctx, input) {
    const body = writtenBody(input.text);
    const title = noteTitle(body);
    if (!body || !title) return fail("invalid_input", "a note needs some text");
    return insertItem(ctx, input, { type: "note", title, body });
  },
});

export const addDecision = defineTool({
  name: "add_decision",
  description:
    "Record a decision taken in a node, with its rationale, so it is not discussed again: a note marked as a decision. " +
    'Use it when someone settles something ("we go with Stripe", "the launch moves to May").',
  readOnly: false,
  input: z.strictObject({
    node: nodeRef,
    decision: titleText,
    rationale: richText("Why it was decided").optional(),
  }),
  output: itemOutput,
  run: (ctx, input) =>
    insertItem(ctx, { node: input.node }, { type: "decision", title: input.decision, body: writtenBody(input.rationale) }),
});

const changeShape = z.object({
  title: z.string(),
  body: z.string().nullable(),
  type: z.enum(itemTypes),
  priority: z.number().nullable(),
  dueOn: z.string().nullable(),
  dueTime: z.string().nullable(),
  status: z.enum(["open", "done"]),
});

export const updateItem = defineTool({
  name: "update_item",
  description:
    "Change an item by id: its title, notes (a note's text), priority, due day or its hour (tasks only), mark a task " +
    "or a decision done or open again, or mark a note as a decision and back (decision). Send only what changes; null " +
    "clears notes, priority, the due day (and its hour), or the hour. Returns the item and its previous values.",
  readOnly: false,
  input: z
    .strictObject({
      id: z.uuid(),
      title: titleText.optional(),
      notes: richText("The new notes").nullable().optional(),
      priority: priority.nullable().optional(),
      dueOn: dueOn.nullable().optional(),
      dueTime: dueTime.nullable().optional(),
      status: z.enum(["open", "done"]).optional(),
      decision: z.boolean().optional().describe("Mark a note as a decision (true), or a decision back to a plain note (false)."),
    })
    .refine((value) => Object.keys(value).some((key) => key !== "id"), { message: "nothing to change" }),
  output: z.object({ item: itemSchema, previous: changeShape }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.id);
    if (isError(found)) return found;
    const { row, scope } = found;
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    if (row.type !== "task" && (input.priority != null || input.dueOn != null || input.dueTime != null)) {
      return fail("invalid_input", `a ${row.type} has no priority or due date: only tasks do`);
    }
    if (row.type === "note" && input.status !== undefined) return fail("invalid_input", "a note has no status");
    if (row.type === "note" && input.title !== undefined) {
      return fail("invalid_input", "a note's title is its first line: change its notes");
    }
    if (input.decision !== undefined && row.type === "task") {
      return fail("invalid_input", "only a note is marked as a decision, not a task");
    }

    const patch: ItemUpdate = {};
    // The kind after the change. A note marked as a decision keeps its words; a decision back to a note opens its text
    // with the decision's words, which become the note's first line and so its title.
    const type = input.decision === undefined ? row.type : input.decision ? "decision" : "note";
    if (type !== row.type) {
      patch.type = type;
      if (type === "note") {
        patch.status = "open";
        patch.completed_at = null;
        if (noteTitle(row.body) !== row.title) patch.body = `<p>${inlineToHtml(row.title)}</p>${row.body ?? ""}`;
      }
    }
    if (input.title !== undefined) patch.title = input.title;
    if (input.notes !== undefined) patch.body = writtenBody(input.notes);
    if (type === "note" && patch.body !== undefined) {
      const title = noteTitle(patch.body);
      if (!title) return fail("invalid_input", "a note needs some text");
      patch.title = title;
    }
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.dueOn !== undefined) patch.due_on = input.dueOn;
    const day = input.dueOn !== undefined ? input.dueOn : row.due_on;
    if (input.dueTime !== undefined) {
      if (input.dueTime !== null && day === null) return fail("invalid_input", "an hour needs its due day (dueOn)");
      patch.due_time = input.dueTime;
    }
    // A task that loses its day loses its hour.
    if (input.dueOn === null && row.due_time !== null) patch.due_time = null;
    if (input.status !== undefined && input.status !== row.status) {
      patch.status = input.status;
      patch.completed_at = input.status === "done" ? new Date().toISOString() : null;
    }
    const previous = {
      title: row.title,
      body: row.body,
      type: row.type as ItemType,
      priority: row.priority,
      dueOn: row.due_on,
      dueTime: hourOf(row.due_time),
      status: row.status,
    };
    if (Object.keys(patch).length === 0) return ok({ item: toItem(row, scope), previous });
    patch.changed_source = mark.source;
    patch.changed_agent_label = mark.agent_label;

    const { data, error } = await ctx.db
      .from("items")
      .update(patch)
      .eq("id", row.id)
      .eq("owner_id", ctx.ownerId)
      .is("deleted_at", null)
      .select(ITEM_COLUMNS)
      .maybeSingle();
    if (error) return dbFail("saving the change", error);
    if (!data) return fail("not_found", `item ${row.id} was deleted meanwhile`);
    return ok({ item: toItem(data, scope), previous });
  },
});

const branchOutput = z.object({
  item: itemSchema,
  // How many items the deletion or the restore took: the item and what hangs from it.
  branch: z.number(),
});

export const deleteItem = defineTool({
  name: "delete_item",
  description:
    "Delete an item by id, with everything that hangs from it (a task's subtasks and notes). The deletion can be " +
    "undone, so it does not need confirmation. Returns the deleted item and how many items went with it.",
  readOnly: false,
  input: z.strictObject({ id: z.uuid() }),
  output: branchOutput,
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.id, true);
    if (isError(found)) return found;
    if (found.row.deleted_at) return ok({ item: toItem(found.row, found.scope), branch: 0 });
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    const { data, error } = await ctx.db.rpc("delete_item_branch", {
      p_item: input.id,
      p_source: mark.source,
      p_agent_label: mark.agent_label as string,
    });
    if (error) return dbFail("deleting the item", error);
    const rows = (data ?? []) as ItemRow[];
    const own = rows.find((row) => row.id === input.id);
    // No row of its own: another writer deleted it between the read and the update, which is the same outcome.
    if (!own) return ok({ item: toItem({ ...found.row, deleted_at: new Date().toISOString() }, found.scope), branch: 0 });
    return ok({ item: toItem(own, found.scope), branch: rows.length });
  },
});

// Undo of a deletion: the branch deleted with the item comes back whole, and nothing deleted before on its own. Not
// offered to models: the screens and the chat's undo button call it.
export async function restoreItem(ctx: ToolContext, id: string): Promise<ToolResult<z.infer<typeof branchOutput>>> {
  const found = await reachableItem(ctx, id, true);
  if (isError(found)) return found;
  if (!found.row.deleted_at) return ok({ item: toItem(found.row, found.scope), branch: 0 });
  const mark = origin(ctx);
  if (!mark) return fail("internal", "an agent write needs its token's label");
  // A subtask deleted before its parent comes back with the parent's branch first: a live item never hangs from a
  // deleted one. The topmost deleted ancestor is restored, and then the item itself.
  let top: ItemRow | null = null;
  for (let cursor = found.row.parent_item_id; cursor; ) {
    const { data: parent, error: parentError } = await ctx.db
      .from("items")
      .select(ITEM_COLUMNS)
      .eq("id", cursor)
      .eq("owner_id", ctx.ownerId)
      .maybeSingle();
    if (parentError) return dbFail("reading the parent task", parentError);
    if (!parent) break;
    if (parent.deleted_at) top = parent;
    cursor = parent.parent_item_id;
  }
  if (top) {
    const { error: upError } = await ctx.db.rpc("restore_item_branch", { p_item: top.id, p_source: mark.source, p_agent_label: mark.agent_label as string });
    if (upError) return dbFail("restoring the parent task", upError);
  }
  const { data, error } = await ctx.db.rpc("restore_item_branch", {
    p_item: id,
    p_source: mark.source,
    p_agent_label: mark.agent_label as string,
  });
  if (error) return dbFail("restoring the item", error);
  const rows = (data ?? []) as ItemRow[];
  const own = rows.find((row) => row.id === id);
  if (own) return ok({ item: toItem(own, found.scope), branch: rows.length });
  // Restoring its parent's branch already brought it back.
  const again = await reachableItem(ctx, id);
  if (isError(again)) return fail("not_found", `item ${id} was restored or changed meanwhile`);
  return ok({ item: toItem(again.row, again.scope), branch: rows.length });
}

const statusFilter = z
  .enum(["open", "done", "all"])
  .default("open")
  .describe("open (default), done, or all.");

export const listItems = defineTool({
  name: "list_items",
  description:
    "List the items of a node, or of General (node null), optionally of one type (task, note, decision) and status, or " +
    "only what hangs from one task (parent). Tasks come by priority then due date; the rest newest first. With " +
    "includeSubprojects, also the items of every node below. Each item says the task it hangs from (parentId).",
  readOnly: true,
  input: z.strictObject({
    node: nodeRef,
    parent: parentRef,
    type: z.enum(itemTypes).optional(),
    status: statusFilter,
    includeSubprojects: z.boolean().default(false),
  }),
  output: z.object({ node: z.object({ id: z.string().nullable(), path: z.string().nullable() }), items: z.array(itemSchema) }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let nodeId: string | null;
    if (input.parent !== undefined) {
      const parent = await reachableItem(ctx, input.parent);
      if (isError(parent)) return parent;
      nodeId = parent.row.node_id;
    } else {
      const resolved = resolveWritePlace(scope, input.node);
      if (isError(resolved)) return resolved;
      nodeId = resolved.node?.id ?? null;
    }
    const node = nodeId === null ? null : scope.all.get(nodeId)!;
    const reach = node
      ? reachOf(scope, { kind: "node", node }, input.includeSubprojects && input.parent === undefined)
      : reachOf(scope, { kind: "general" });
    const read = await selectAllItems(
      ctx,
      reach,
      (query) => {
        let q = query.is("deleted_at", null);
        if (input.parent !== undefined) q = q.eq("parent_item_id", input.parent);
        if (input.type) q = q.eq("type", input.type);
        // A note keeps the open status: it lists with what is open and never as done.
        if (input.status !== "all") q = q.eq("status", input.status);
        return q;
      },
      "listing the items",
    );
    if (isError(read)) return read;
    const items = read.rows.map((row) => toItem(row, scope));
    const tasks = items.filter((item) => item.type === "task").sort(byPriorityThenDue);
    const rest = items.filter((item) => item.type !== "task").sort(newestFirst);
    return ok({ node: { id: node?.id ?? null, path: node?.path ?? null }, items: [...tasks, ...rest] });
  },
});

// `%`, `_` and the escape character itself are literal in what the person typed.
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const searchItems = defineTool({
  name: "search_items",
  description:
    "Search the titles and notes of items in a node and every node below it, in General (node null), or, by default, " +
    "everything reachable, and the mail of the accounts in reach by sender, subject, and text. Case-insensitive. " +
    "Returns up to 50 items, newest first, and up to 20 messages.",
  readOnly: true,
  input: z.strictObject({
    query: z.string().trim().min(1).max(200),
    node: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("The node's id or path, or null for General. Omit it for the current node, or for everything."),
    type: z.enum(itemTypes).optional(),
    status: z.enum(["open", "done", "all"]).default("all").describe("open, done, or all (default)."),
  }),
  output: z.object({ items: z.array(itemSchema), mail: z.array(mailRowSchema).optional() }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const resolved = resolveReadPlace(loaded.scope, input.node);
    if (isError(resolved)) return resolved;
    const reach = reachOf(loaded.scope, resolved.place);
    const pattern = likePattern(input.query);
    const found = new Map<string, ReturnType<typeof toItem>>();
    for (const column of ["title", "body"] as const) {
      const read = await selectAllItems(
        ctx,
        reach,
        (query) => {
          let q = query.is("deleted_at", null).ilike(column, pattern);
          if (input.type) q = q.eq("type", input.type);
          if (input.status !== "all") q = q.eq("status", input.status);
          return q;
        },
        "searching",
      );
      if (isError(read)) return read;
      for (const row of read.rows) found.set(row.id, toItem(row, loaded.scope));
    }
    const items = [...found.values()].sort(newestFirst).slice(0, 50);
    // A filter by kind or status asks for items only.
    if (input.type || input.status !== "all") return ok({ items });
    const mail = await searchMail(ctx, loaded.scope, resolved.place, input.query);
    // The mail failing never takes the items' answer with it.
    if (isError(mail)) {
      console.error("search: the mail could not be read", mail.message);
      return ok({ items });
    }
    return ok({ items, mail: mail.rows });
  },
});

// Versions and the trash ----------------------------------------------------------------------------------------------

// A version written before an item had an hour carries none.
const snapshotSchema = z.object({
  title: z.string(),
  body: z.string().nullable(),
  status: z.enum(["open", "done"]),
  priority: z.number().nullable(),
  due_on: z.string().nullable(),
  due_time: z.string().nullable().default(null),
  parent_item_id: z.string().nullable(),
  deleted_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export type Revision = {
  id: string;
  createdAt: string;
  source: Source;
  agentLabel: string | null;
  snapshot: z.infer<typeof snapshotSchema>;
};

// The versions an item left, newest first: each holds the item as it was before a change, with who made the change.
export async function listRevisions(ctx: ToolContext, itemId: string): Promise<ToolResult<{ revisions: Revision[] }>> {
  const found = await reachableItem(ctx, itemId, true);
  if (isError(found)) return found;
  const { data, error } = await ctx.db
    .from("revisions")
    .select("id, created_at, source, agent_label, snapshot")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) return dbFail("reading the versions", error);
  const revisions: Revision[] = [];
  for (const row of data) {
    const snapshot = snapshotSchema.safeParse(row.snapshot);
    if (!snapshot.success) {
      console.error(`revision ${row.id}: its snapshot does not read`, z.prettifyError(snapshot.error));
      continue;
    }
    revisions.push({ id: row.id, createdAt: row.created_at, source: row.source, agentLabel: row.agent_label, snapshot: snapshot.data });
  }
  return ok({ revisions });
}

// Restoring a version writes its photo over the item; that change leaves its own version, so it can be undone too. The
// deletion is not part of it: a branch is deleted and restored only whole, through the trash.
export async function restoreRevision(ctx: ToolContext, revisionId: string): Promise<ToolResult<z.infer<typeof itemOutput>>> {
  const { data: revision, error: readError } = await ctx.db
    .from("revisions")
    .select("id, item_id, snapshot")
    .eq("id", revisionId)
    .maybeSingle();
  if (readError) return dbFail("reading the version", readError);
  if (!revision?.item_id) return fail("not_found", `no version with id ${revisionId} is reachable here`);
  const found = await reachableItem(ctx, revision.item_id, true);
  if (isError(found)) return found;
  const snapshot = snapshotSchema.safeParse(revision.snapshot);
  if (!snapshot.success) return fail("internal", "the version could not be read");
  const mark = origin(ctx);
  if (!mark) return fail("internal", "an agent write needs its token's label");
  const photo = snapshot.data;
  // The parent the version names comes back only where it still lives in the item's place; a version taken before a move
  // keeps the item where it is now.
  let parentId = found.row.parent_item_id;
  if (photo.parent_item_id !== found.row.parent_item_id) {
    if (photo.parent_item_id === null) parentId = null;
    else {
      const { data: parent, error: parentError } = await ctx.db
        .from("items")
        .select("id, node_id")
        .eq("id", photo.parent_item_id)
        .eq("owner_id", ctx.ownerId)
        .maybeSingle();
      if (parentError) return dbFail("reading the version's parent task", parentError);
      if (parent && parent.node_id === found.row.node_id) parentId = parent.id;
    }
  }
  const { data, error } = await ctx.db
    .from("items")
    .update({
      title: photo.title,
      body: photo.body,
      status: photo.status,
      priority: photo.priority,
      due_on: photo.due_on,
      due_time: photo.due_on === null ? null : photo.due_time,
      parent_item_id: parentId,
      completed_at: photo.completed_at,
      changed_source: mark.source,
      changed_agent_label: mark.agent_label,
    })
    .eq("id", revision.item_id)
    .eq("owner_id", ctx.ownerId)
    .select(ITEM_COLUMNS)
    .single();
  if (error) return dbFail("restoring the version", error);
  return ok({ item: toItem(data, found.scope) });
}

export type TrashEntry = z.infer<typeof itemSchema> & { branch: number };

// The trash: what was deleted, each branch once (by its top item), newest first.
export async function listTrash(ctx: ToolContext): Promise<ToolResult<{ items: TrashEntry[] }>> {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const read = await selectAllItems(ctx, reachOf(loaded.scope, { kind: "all" }), (query) => query.not("deleted_at", "is", null), "reading the trash");
  if (isError(read)) return read;
  const byId = new Map(read.rows.map((row) => [row.id, row]));
  const tops = new Map<string, { row: ItemRow; branch: number }>();
  for (const row of read.rows) {
    // An item deleted with its parent belongs to the parent's branch.
    let top = row;
    for (let parent = top.parent_item_id ? byId.get(top.parent_item_id) : undefined; parent && parent.deleted_at === top.deleted_at; ) {
      top = parent;
      parent = top.parent_item_id ? byId.get(top.parent_item_id) : undefined;
    }
    const entry = tops.get(top.id) ?? { row: top, branch: 0 };
    entry.branch++;
    tops.set(top.id, entry);
  }
  const items = [...tops.values()]
    .sort((a, b) => (a.row.deleted_at! < b.row.deleted_at! ? 1 : -1))
    .slice(0, 200)
    .map(({ row, branch }) => ({ ...toItem(row, loaded.scope), branch }));
  return ok({ items });
}
