import { z } from "zod";
import type { Database } from "@/lib/db/types";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { dbFail, fail, isError, ok, type ToolResult } from "./result";
import { ITEM_COLUMNS, itemSchema, itemTypes, selectAllItems, toItem, byPriorityThenDue, newestFirst } from "./rows";
import { loadScope, resolveNode, subtree, type Scope } from "./tree";

type ItemInsert = Database["public"]["Tables"]["items"]["Insert"];
type ItemUpdate = Database["public"]["Tables"]["items"]["Update"];

const nodeRef = z
  .string()
  .min(1)
  .optional()
  .describe('The node: its id, or its path such as "Acme / Web / Landing". Omit it to use the current node.');

const priority = z
  .number()
  .int()
  .min(1)
  .max(4)
  .describe("1 is the most urgent, 4 the least.");

const dueOn = z.iso.date().describe("A calendar day, YYYY-MM-DD.");

const webUrl = z
  .url({ protocol: /^https?$/ })
  .describe("An http or https address.");

const itemOutput = z.object({ item: itemSchema });

// The writer's mark: every write says where it came from, and an agent's also which token wrote it.
function origin(ctx: ToolContext): Pick<ItemInsert, "source" | "agent_label"> | null {
  if (ctx.source === "agent") {
    return ctx.agentLabel ? { source: "agent", agent_label: ctx.agentLabel } : null;
  }
  return { source: ctx.source, agent_label: null };
}

async function insertItem(ctx: ToolContext, nodeRefValue: string | undefined, fields: Omit<ItemInsert, "node_id">) {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const resolved = resolveNode(loaded.scope, nodeRefValue);
  if (isError(resolved)) return resolved;
  const mark = origin(ctx);
  if (!mark) return fail("internal", "an agent write needs its token's label");
  const { data, error } = await ctx.db
    .from("items")
    .insert({ ...fields, ...mark, node_id: resolved.node.id })
    .select(ITEM_COLUMNS)
    .single();
  if (error) return dbFail("saving the item", error);
  return ok({ item: toItem(data, loaded.scope) });
}

// Reads one item the caller may reach; a deleted one only when asked for.
async function reachableItem(ctx: ToolContext, id: string, withDeleted = false) {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const { data, error } = await ctx.db.from("items").select(ITEM_COLUMNS).eq("id", id).maybeSingle();
  if (error) return dbFail("reading the item", error);
  if (!data || !loaded.scope.reachable.has(data.node_id) || (data.deleted_at && !withDeleted)) {
    return fail("not_found", `no item with id ${id} is reachable here`);
  }
  return ok({ row: data, scope: loaded.scope });
}

export const createTask = defineTool({
  name: "create_task",
  description:
    "Create a task in a node. Use it for anything someone has to do. Give a short imperative title; put detail in " +
    "notes. Priority 1 is the most urgent and 4 the least (default 4). Returns the created task.",
  readOnly: false,
  input: z.object({
    node: nodeRef,
    title: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(10_000).optional(),
    priority: priority.optional(),
    dueOn: dueOn.optional(),
  }),
  output: itemOutput,
  run: (ctx, input) =>
    insertItem(ctx, input.node, {
      type: "task",
      title: input.title,
      body: input.notes ?? null,
      priority: input.priority ?? 4,
      due_on: input.dueOn ?? null,
    }),
});

export const addDecision = defineTool({
  name: "add_decision",
  description:
    "Record a decision taken in a node, with its rationale, so it is not discussed again. Use it when someone " +
    'settles something ("we go with Stripe", "the launch moves to May").',
  readOnly: false,
  input: z.object({
    node: nodeRef,
    decision: z.string().trim().min(1).max(500),
    rationale: z.string().trim().max(10_000).optional(),
  }),
  output: itemOutput,
  run: (ctx, input) =>
    insertItem(ctx, input.node, { type: "decision", title: input.decision, body: input.rationale ?? null }),
});

export const addLink = defineTool({
  name: "add_link",
  description: "Save a link in a node: a document, a design, a repository, a ticket. Give it a readable title.",
  readOnly: false,
  input: z.object({
    node: nodeRef,
    url: webUrl,
    title: z.string().trim().min(1).max(500).optional(),
    notes: z.string().trim().max(10_000).optional(),
  }),
  output: itemOutput,
  run: (ctx, input) =>
    insertItem(ctx, input.node, {
      type: "link",
      url: input.url,
      title: input.title ?? input.url,
      body: input.notes ?? null,
    }),
});

export const addReview = defineTool({
  name: "add_review",
  description:
    "Record something to review in a node: a delivery to check, feedback to read, a document to approve. It may " +
    "carry a link.",
  readOnly: false,
  input: z.object({
    node: nodeRef,
    title: z.string().trim().min(1).max(500),
    url: webUrl.optional(),
    notes: z.string().trim().max(10_000).optional(),
  }),
  output: itemOutput,
  run: (ctx, input) =>
    insertItem(ctx, input.node, {
      type: "review",
      title: input.title,
      url: input.url ?? null,
      body: input.notes ?? null,
    }),
});

const changeShape = z.object({
  title: z.string(),
  body: z.string().nullable(),
  url: z.string().nullable(),
  priority: z.number().nullable(),
  dueOn: z.string().nullable(),
  status: z.enum(["open", "done"]),
});

export const updateItem = defineTool({
  name: "update_item",
  description:
    "Change an item by id: its title, notes, link, priority or due date (tasks only), or mark it done or open " +
    "again. Send only what changes; null clears notes, priority, or due date. Returns the item and its previous " +
    "values.",
  readOnly: false,
  input: z
    .object({
      id: z.uuid(),
      title: z.string().trim().min(1).max(500).optional(),
      notes: z.string().trim().max(10_000).nullable().optional(),
      url: webUrl.nullable().optional(),
      priority: priority.nullable().optional(),
      dueOn: dueOn.nullable().optional(),
      status: z.enum(["open", "done"]).optional(),
    })
    .refine((value) => Object.keys(value).some((key) => key !== "id"), { message: "nothing to change" }),
  output: z.object({ item: itemSchema, previous: changeShape }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.id);
    if (isError(found)) return found;
    const { row, scope } = found;
    if (row.type !== "task" && (input.priority != null || input.dueOn != null)) {
      return fail("invalid_input", `a ${row.type} has no priority or due date: only tasks do`);
    }
    if (row.type === "link" && input.url === null) return fail("invalid_input", "a link needs its address");

    const patch: ItemUpdate = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.notes !== undefined) patch.body = input.notes;
    if (input.url !== undefined) patch.url = input.url;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.dueOn !== undefined) patch.due_on = input.dueOn;
    if (input.status !== undefined && input.status !== row.status) {
      patch.status = input.status;
      patch.completed_at = input.status === "done" ? new Date().toISOString() : null;
    }
    const previous = {
      title: row.title,
      body: row.body,
      url: row.url,
      priority: row.priority,
      dueOn: row.due_on,
      status: row.status,
    };
    if (Object.keys(patch).length === 0) return ok({ item: toItem(row, scope), previous });

    const { data, error } = await ctx.db
      .from("items")
      .update(patch)
      .eq("id", row.id)
      .is("deleted_at", null)
      .select(ITEM_COLUMNS)
      .maybeSingle();
    if (error) return dbFail("saving the change", error);
    if (!data) return fail("not_found", `item ${row.id} was deleted meanwhile`);
    return ok({ item: toItem(data, scope), previous });
  },
});

export const deleteItem = defineTool({
  name: "delete_item",
  description:
    "Delete an item by id. The deletion can be undone, so it does not need confirmation. Returns the deleted item.",
  readOnly: false,
  input: z.object({ id: z.uuid() }),
  output: itemOutput,
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.id, true);
    if (isError(found)) return found;
    if (found.row.deleted_at) return ok({ item: toItem(found.row, found.scope) });
    const { data, error } = await ctx.db
      .from("items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", input.id)
      .is("deleted_at", null)
      .select(ITEM_COLUMNS)
      .maybeSingle();
    if (error) return dbFail("deleting the item", error);
    // No row: another writer deleted it between the read and the update, which is the same outcome.
    if (!data) return ok({ item: toItem({ ...found.row, deleted_at: new Date().toISOString() }, found.scope) });
    return ok({ item: toItem(data, found.scope) });
  },
});

// Undo of a deletion. Not offered to models: the screens and the chat's undo button call it.
export async function restoreItem(ctx: ToolContext, id: string): Promise<ToolResult<z.infer<typeof itemOutput>>> {
  const found = await reachableItem(ctx, id, true);
  if (isError(found)) return found;
  if (!found.row.deleted_at) return ok({ item: toItem(found.row, found.scope) });
  const { data, error } = await ctx.db
    .from("items")
    .update({ deleted_at: null })
    .eq("id", id)
    .select(ITEM_COLUMNS)
    .single();
  if (error) return dbFail("restoring the item", error);
  return ok({ item: toItem(data, found.scope) });
}

const statusFilter = z
  .enum(["open", "done", "all"])
  .default("open")
  .describe("open (default), done, or all.");

function nodesFor(scope: Scope, nodeId: string, withDescendants: boolean): string[] {
  if (!withDescendants) return [nodeId];
  return [...subtree(scope.all, nodeId)].filter((id) => scope.reachable.has(id));
}

export const listItems = defineTool({
  name: "list_items",
  description:
    "List a node's items, optionally of one type (task, decision, link, review) and status. Tasks come by " +
    "priority then due date; the rest newest first. With includeSubprojects, also the items of every node below.",
  readOnly: true,
  input: z.object({
    node: nodeRef,
    type: z.enum(itemTypes).optional(),
    status: statusFilter,
    includeSubprojects: z.boolean().default(false),
  }),
  output: z.object({ node: z.object({ id: z.string(), path: z.string() }), items: z.array(itemSchema) }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const resolved = resolveNode(loaded.scope, input.node);
    if (isError(resolved)) return resolved;
    const read = await selectAllItems(
      ctx,
      nodesFor(loaded.scope, resolved.node.id, input.includeSubprojects),
      (query) => {
        let q = query.is("deleted_at", null);
        if (input.type) q = q.eq("type", input.type);
        if (input.status !== "all") q = q.eq("status", input.status);
        return q;
      },
      "listing the items",
    );
    if (isError(read)) return read;
    const items = read.rows.map((row) => toItem(row, loaded.scope));
    const tasks = items.filter((item) => item.type === "task").sort(byPriorityThenDue);
    const rest = items.filter((item) => item.type !== "task").sort(newestFirst);
    return ok({ node: { id: resolved.node.id, path: resolved.node.path }, items: [...tasks, ...rest] });
  },
});

// `%`, `_` and the escape character itself are literal in what the person typed.
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const searchItems = defineTool({
  name: "search_items",
  description:
    "Search the titles and notes of items in a node and every node below it (by default, everything reachable). " +
    "Case-insensitive. Returns up to 50 matches, newest first.",
  readOnly: true,
  input: z.object({
    query: z.string().trim().min(1).max(200),
    node: nodeRef,
    type: z.enum(itemTypes).optional(),
    status: z.enum(["open", "done", "all"]).default("all").describe("open, done, or all (default)."),
  }),
  output: z.object({ items: z.array(itemSchema) }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    let nodeIds: string[];
    if (input.node === undefined && !loaded.scope.root) {
      nodeIds = [...loaded.scope.reachable];
    } else {
      const resolved = resolveNode(loaded.scope, input.node);
      if (isError(resolved)) return resolved;
      nodeIds = nodesFor(loaded.scope, resolved.node.id, true);
    }
    const pattern = likePattern(input.query);
    const found = new Map<string, ReturnType<typeof toItem>>();
    for (const column of ["title", "body"] as const) {
      const read = await selectAllItems(
        ctx,
        nodeIds,
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
    return ok({ items: [...found.values()].sort(newestFirst).slice(0, 50) });
  },
});
