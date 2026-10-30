import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { inlineLink } from "@/lib/inline-links";
import { writtenBody } from "@/lib/inline-links";
import { firstLine } from "@/lib/rich-text";
import { defineTool } from "./define";
import { dueOn, titleText } from "./fields";
import { insertItem, origin, reachableItem } from "./items";
import { accountMap } from "./mail";
import { taskMailSchema, type TaskMail } from "./mail-schema";
import { taskMailOf } from "./waits";
import { dbFail, fail, isError, ok } from "./result";
import { hourOf, ITEM_COLUMNS, itemSchema, selectAllItems, toItem } from "./rows";
import { describePlace, loadScope, reachOf, resolveReadPlace, resolveWritePlace, type Scope } from "./tree";

type ItemRow = Database["public"]["Tables"]["items"]["Row"];

// The tasks of a view in the four groups every screen shows —Overdue, Today, Upcoming day by day, and No date— for the
// person's calendar day, and the writes that move a task between places, groups, and positions.

const day = z.iso.date();

const placeRef = z
  .string()
  .min(1)
  .nullable()
  .optional()
  .describe("A node's id or path, or null for General (no client or project). Omit it for everything in reach.");

// What a task's row shows.
export const taskRowSchema = z.object({
  id: z.string(),
  // As written: a link goes over its words, [words](address).
  title: z.string(),
  // The first line of its notes, in plain text.
  description: z.string().nullable(),
  status: z.enum(["open", "done"]),
  priority: z.number().nullable(),
  dueOn: z.string().nullable(),
  dueTime: z.string().nullable(),
  // Its place as a readable path, and the color that place shows; null for General.
  nodeId: z.string().nullable(),
  path: z.string().nullable(),
  color: z.string().nullable(),
  // The task it hangs from, for a subtask that is due on its own day.
  parentId: z.string().nullable(),
  subtasks: z.object({ done: z.number(), total: z.number() }),
  notes: z.number(),
  source: z.enum(["manual", "chat", "agent", "review"]),
  agentLabel: z.string().nullable(),
  position: z.number(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  // What mail it waits for; null when it waits for none.
  mail: taskMailSchema.nullable(),
});

export type TaskRow = z.infer<typeof taskRowSchema>;

const groupSchema = z.object({ count: z.number(), tasks: z.array(taskRowSchema) });

export const tasksOutput = z.object({
  scope: z.object({ kind: z.enum(["all", "general", "node"]), id: z.string().nullable(), path: z.string().nullable() }),
  // The person's day the groups were cut on.
  day: z.string(),
  groups: z.object({
    overdue: groupSchema,
    today: groupSchema,
    upcoming: z.object({
      // Every upcoming task, whatever the days shown.
      count: z.number(),
      days: z.array(z.object({ day: z.string(), count: z.number(), tasks: z.array(taskRowSchema) })),
      // The upcoming tasks of the days past the cap, when a cap was asked.
      hidden: z.number(),
    }),
    noDate: groupSchema,
  }),
  // With completed: the finished tasks, latest first.
  completed: groupSchema.nullable(),
});

export type TasksView = z.infer<typeof tasksOutput>;
export type TaskGroup = "overdue" | "today" | "upcoming" | "noDate";

// A task is in a group when it has a day, or when it hangs from no task: a dated subtask shows where it falls due, and an
// undated one only inside its parent's row.
export function groupOf(row: { due_on: string | null; parent_item_id: string | null }, today: string): TaskGroup | null {
  if (row.due_on === null) return row.parent_item_id === null ? "noDate" : null;
  if (row.due_on < today) return "overdue";
  if (row.due_on === today) return "today";
  return "upcoming";
}

// Whether a task is a row of the groups, whatever the day: what a node's number and the board's figures count.
export function shownAsRow(row: { due_on: string | null; parent_item_id: string | null }): boolean {
  return row.due_on !== null || row.parent_item_id === null;
}

type Sort = "date" | "priority" | "manual";

const byPosition = (a: TaskRow, b: TaskRow) =>
  a.position - b.position || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byPriority = (a: TaskRow, b: TaskRow) => (a.priority ?? 9) - (b.priority ?? 9);
// A timed task comes before the untimed ones of its day, by its hour.
const byWhen = (a: TaskRow, b: TaskRow) => {
  if (a.dueOn !== b.dueOn) return (a.dueOn ?? "9999-12-31") < (b.dueOn ?? "9999-12-31") ? -1 : 1;
  if (a.dueTime !== b.dueTime) return (a.dueTime ?? "99:99") < (b.dueTime ?? "99:99") ? -1 : 1;
  return 0;
};

function order(rows: TaskRow[], sort: Sort, group: TaskGroup): TaskRow[] {
  const compare =
    sort === "manual" || (sort === "date" && group === "noDate")
      ? byPosition
      : sort === "priority"
        ? (a: TaskRow, b: TaskRow) => byPriority(a, b) || byWhen(a, b) || byPosition(a, b)
        : (a: TaskRow, b: TaskRow) => byWhen(a, b) || byPriority(a, b) || byPosition(a, b);
  return [...rows].sort(compare);
}

// A task as its row shows it, from its row, the counts of what hangs from it, and the mail it waits for.
export function rowOf(row: ItemRow, scope: Scope, counts: Map<string, { done: number; total: number; notes: number }>, mail: Map<string, TaskMail>): TaskRow {
  const node = row.node_id === null ? null : scope.all.get(row.node_id);
  const count = counts.get(row.id);
  return {
    id: row.id,
    title: row.title,
    description: firstLine(row.body) || null,
    status: row.status,
    priority: row.priority,
    dueOn: row.due_on,
    dueTime: hourOf(row.due_time),
    nodeId: row.node_id,
    path: node?.path ?? null,
    color: node?.color ?? null,
    parentId: row.parent_item_id,
    subtasks: { done: count?.done ?? 0, total: count?.total ?? 0 },
    notes: count?.notes ?? 0,
    source: row.source,
    agentLabel: row.agent_label,
    position: Number(row.position),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    mail: mail.get(row.id) ?? null,
  };
}

export const getTasks = defineTool({
  name: "get_tasks",
  description:
    "The tasks of a view for the person's calendar day, in four groups: overdue, today, upcoming (day by day), and no " +
    "date (in the person's manual order); over everything in reach, General alone (node null), or one node and " +
    "everything below it. Each group says how many it holds; each task says its place, its subtasks done and in all, " +
    "and how many notes it has. Use it to answer what is due, what is late, and what is next.",
  readOnly: true,
  input: z.strictObject({
    node: placeRef,
    today: day.describe("The person's calendar day."),
    upcomingDays: z.number().int().min(1).max(60).optional().describe("Show at most this many upcoming days that hold tasks (the nearest)."),
    withCompleted: z.boolean().default(false).describe("Also bring the finished tasks."),
    sort: z.enum(["date", "priority", "manual"]).default("date").describe("By date (no date in its manual order), by priority, or all by the manual order."),
  }),
  output: tasksOutput,
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    const resolved = resolveReadPlace(scope, input.node);
    if (isError(resolved)) return resolved;
    // The open tasks, every subtask (its parent's count reads the finished ones too), and the notes and decisions that
    // hang from a task; the finished top tasks only when asked.
    const read = await selectAllItems(
      ctx,
      reachOf(scope, resolved.place),
      (query) => {
        const live = query.is("deleted_at", null);
        return input.withCompleted ? live : live.or("status.eq.open,parent_item_id.not.is.null");
      },
      "reading the tasks",
    );
    if (isError(read)) return read;
    const counts = new Map<string, { done: number; total: number; notes: number }>();
    for (const row of read.rows) {
      if (!row.parent_item_id) continue;
      const count = counts.get(row.parent_item_id) ?? { done: 0, total: 0, notes: 0 };
      if (row.type === "task") {
        count.total++;
        if (row.status === "done") count.done++;
      } else count.notes++;
      counts.set(row.parent_item_id, count);
    }
    const waits = await taskMailOf(ctx, read.rows.filter((row) => row.type === "task").map((row) => row.id));
    if (isError(waits)) return waits;
    const groups: Record<TaskGroup, TaskRow[]> = { overdue: [], today: [], upcoming: [], noDate: [] };
    const completed: TaskRow[] = [];
    for (const row of read.rows) {
      if (row.type !== "task") continue;
      const group = groupOf(row, input.today);
      if (group === null) continue;
      if (row.status === "open") groups[group].push(rowOf(row, scope, counts, waits.byTask));
      else if (input.withCompleted) completed.push(rowOf(row, scope, counts, waits.byTask));
    }
    const sorted = (group: TaskGroup) => order(groups[group], input.sort, group);
    // Upcoming reads day by day, nearest first, each day in the order asked.
    const byDay = new Map<string, TaskRow[]>();
    for (const task of sorted("upcoming")) byDay.set(task.dueOn!, [...(byDay.get(task.dueOn!) ?? []), task]);
    const days = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([when, tasks]) => ({ day: when, count: tasks.length, tasks }));
    const shown = input.upcomingDays === undefined ? days : days.slice(0, input.upcomingDays);
    const finished = completed.sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1));
    return ok({
      scope: describePlace(resolved.place),
      day: input.today,
      groups: {
        overdue: { count: groups.overdue.length, tasks: sorted("overdue") },
        today: { count: groups.today.length, tasks: sorted("today") },
        upcoming: {
          count: groups.upcoming.length,
          days: shown,
          hidden: groups.upcoming.length - shown.reduce((sum, entry) => sum + entry.count, 0),
        },
        noDate: { count: groups.noDate.length, tasks: sorted("noDate") },
      },
      completed: input.withCompleted ? { count: finished.length, tasks: finished.slice(0, 200) } : null,
    });
  },
});

export const moveItem = defineTool({
  name: "move_item",
  description:
    "Move an item by id to another place —a node, or General (node null)— or under another task (parent), or out of " +
    "its parent task (parent null). A task moves with its subtasks and notes. Returns the item and where it was, so the " +
    "move can be undone.",
  readOnly: false,
  input: z
    .strictObject({
      id: z.uuid(),
      node: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("The new place: a node's id or path, or null for General. With a parent, it must be the parent's place."),
      parent: z.uuid().nullable().optional().describe("The task it will hang from, or null to hang from its place."),
    })
    .refine((value) => value.node !== undefined || value.parent !== undefined, { message: "say where: node, parent, or both" }),
  output: z.object({ item: itemSchema, previous: z.object({ nodeId: z.string().nullable(), parentId: z.string().nullable() }), branch: z.number() }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.id);
    if (isError(found)) return found;
    const { row, scope } = found;
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    let nodeId: string | null = row.node_id;
    let parentId: string | null = input.parent === undefined ? row.parent_item_id : input.parent;
    if (input.node !== undefined) {
      const place = resolveWritePlace(scope, input.node);
      if (isError(place)) return place;
      nodeId = place.node?.id ?? null;
      // A new place without a parent hangs from the place itself.
      if (input.parent === undefined && nodeId !== row.node_id) parentId = null;
    }
    if (input.parent) {
      const parent = await reachableItem(ctx, input.parent);
      if (isError(parent)) return parent;
      if (parent.row.type !== "task") return fail("invalid_input", `a ${parent.row.type} has no children: only a task does`);
      if (input.node !== undefined && parent.row.node_id !== nodeId) {
        return fail("invalid_input", "the parent task lives in another place: omit the node or name the task's own");
      }
      nodeId = parent.row.node_id;
      // Not under itself or its own branch.
      for (let cursor: string | null = parent.row.id; cursor; ) {
        if (cursor === row.id) return fail("invalid_input", "an item cannot move under itself or its own subtasks");
        const step: { data: { parent_item_id: string | null } | null; error: { message: string } | null } = await ctx.db
          .from("items")
          .select("parent_item_id")
          .eq("id", cursor)
          .eq("owner_id", ctx.ownerId)
          .maybeSingle();
        if (step.error) return dbFail("reading the parent task", step.error);
        cursor = step.data?.parent_item_id ?? null;
      }
    }
    const previous = { nodeId: row.node_id, parentId: row.parent_item_id };
    if (nodeId === row.node_id && parentId === row.parent_item_id) return ok({ item: toItem(row, scope), previous, branch: 0 });
    const { data, error } = await ctx.db.rpc("move_item_branch", {
      p_item: row.id,
      p_node: nodeId as string,
      p_parent: parentId as string,
      p_source: mark.source,
      p_agent_label: mark.agent_label as string,
    });
    if (error) return dbFail("moving the item", error);
    const rows = (data ?? []) as ItemRow[];
    const own = rows.find((entry) => entry.id === row.id);
    if (!own) return fail("not_found", `item ${row.id} was deleted meanwhile`);
    const kept = await keepWaitsInSight(ctx, scope, rows);
    if (isError(kept)) return kept;
    return ok({ item: toItem(own, scope), previous, branch: rows.length });
  },
});

// A task that waits for mail in one account and moves to a place that does not see it waits in every account of its new
// place: an account the place does not see would be read for a task that no longer belongs to it. What was ruled out
// there goes with it.
async function keepWaitsInSight(ctx: Parameters<typeof taskMailOf>[0], scope: Scope, rows: ItemRow[]) {
  const tasks = rows.filter((entry) => entry.type === "task");
  const waits = await taskMailOf(ctx, tasks.map((entry) => entry.id));
  if (isError(waits)) return waits;
  const fixed = tasks.filter((entry) => waits.byTask.get(entry.id)?.accountId);
  if (fixed.length === 0) return ok({});
  const mapped = await accountMap(ctx, scope);
  if (isError(mapped)) return mapped;
  const lost = fixed.filter((entry) => !mapped.map.seenFrom(entry.node_id).has(waits.byTask.get(entry.id)!.accountId!)).map((entry) => entry.id);
  if (lost.length === 0) return ok({});
  const { error } = await ctx.db
    .from("task_mail")
    .update({ account_id: null, dismissed: [] })
    .eq("owner_id", ctx.ownerId)
    .in("item_id", lost);
  if (error) return dbFail("the item moved, but letting go of the account its new place does not see failed", error);
  return ok({});
}

export const reorderItems = defineTool({
  name: "reorder_items",
  description:
    "Set the manual order of a group: the ids of its items, first to last (such as the tasks without a date). The " +
    "items keep the places in the order they already held, dealt out in the order given, so nothing outside the group " +
    "moves. Returns each item's new and previous position.",
  readOnly: false,
  input: z.strictObject({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, { message: "an id appears twice" }),
  }),
  output: z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), position: z.number(), previous: z.number() })) }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { data, error } = await ctx.db.from("items").select(ITEM_COLUMNS).in("id", input.ids).eq("owner_id", ctx.ownerId).is("deleted_at", null);
    if (error) return dbFail("reading the items", error);
    const rows = new Map(data.map((row) => [row.id, row]));
    const missing = input.ids.find((id) => {
      const row = rows.get(id);
      return !row || !(row.node_id === null ? loaded.scope.general : loaded.scope.reachable.has(row.node_id));
    });
    if (missing) return fail("not_found", `no item with id ${missing} is reachable here`);
    // The database deals out the places the group already holds, lowest first, in the order given: the positions never
    // pass through a JavaScript number, which would round them.
    const { data: written, error: writeError } = await ctx.db.rpc("reorder_item_positions", { p_items: input.ids });
    if (writeError) return dbFail("ordering the items", writeError);
    const after = new Map(((written ?? []) as ItemRow[]).map((row) => [row.id, Number(row.position)]));
    return ok({
      items: input.ids.map((id) => {
        const row = rows.get(id)!;
        return { id, title: row.title, position: after.get(id) ?? Number(row.position), previous: Number(row.position) };
      }),
    });
  },
});

export const rescheduleOverdue = defineTool({
  name: "reschedule_overdue",
  description:
    "Move every overdue open task of a view —everything in reach, General (node null), or a node and everything below " +
    "it— to one day, keeping each one's hour. Returns what changed with each task's previous day, so it can be undone.",
  readOnly: false,
  input: z.strictObject({
    node: placeRef,
    today: day.describe("The person's calendar day: what is due before it is overdue."),
    to: dueOn.describe("The new day, today or later."),
  }),
  output: z.object({ count: z.number(), changed: z.array(z.object({ id: z.string(), title: z.string(), previousDueOn: z.string() })) }),
  async run(ctx, input) {
    if (input.to < input.today) return fail("invalid_input", "the new day is before today: the tasks would still be overdue");
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const resolved = resolveReadPlace(loaded.scope, input.node);
    if (isError(resolved)) return resolved;
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    const read = await selectAllItems(
      ctx,
      reachOf(loaded.scope, resolved.place),
      (query) => query.is("deleted_at", null).eq("type", "task").eq("status", "open").lt("due_on", input.today),
      "reading the overdue tasks",
    );
    if (isError(read)) return read;
    if (read.rows.length === 0) return ok({ count: 0, changed: [] });
    const { data, error } = await ctx.db
      .from("items")
      .update({ due_on: input.to, changed_source: mark.source, changed_agent_label: mark.agent_label })
      .in("id", read.rows.map((row) => row.id))
      .eq("owner_id", ctx.ownerId)
      .is("deleted_at", null)
      .eq("status", "open")
      .lt("due_on", input.today)
      .select("id");
    if (error) return dbFail("rescheduling the tasks", error);
    const moved = new Set(data.map((row) => row.id));
    const changed = read.rows
      .filter((row) => moved.has(row.id))
      .map((row) => ({ id: row.id, title: row.title, previousDueOn: row.due_on! }));
    return ok({ count: changed.length, changed });
  },
});

export const requestReview = defineTool({
  name: "request_review",
  description:
    "Ask the person to look at something —a pull request, a delivery, a document—: it becomes a task due today in the " +
    "node, marked with who asked. A link goes over its words.",
  readOnly: false,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it to use the current node."),
    title: titleText,
    url: z.url({ protocol: /^https?$/ }).optional().describe("What to look at, an http or https address; it goes over the title's words."),
    notes: z.string().trim().max(20_000).optional().describe("What to look at, in plain text or the closed list's HTML."),
    today: day.describe("The person's calendar day, where the task falls: the server's clock would put it on another day for a person far from UTC."),
  }),
  output: z.object({ item: itemSchema }),
  run: (ctx, input) =>
    insertItem(ctx, { node: input.node }, {
      type: "task",
      title: input.url ? inlineLink(input.title, input.url) : input.title,
      body: writtenBody(input.notes),
      priority: 4,
      due_on: input.today,
    }),
});
