import { z } from "zod";
import type { Database } from "@/lib/db/types";
import type { ToolContext } from "./context";
import { dbFail, ok, type ToolResult } from "./result";
import type { Reach, Scope } from "./tree";

type ItemRow = Database["public"]["Tables"]["items"]["Row"];

export const ITEM_COLUMNS =
  "id, owner_id, node_id, parent_item_id, type, title, body, status, priority, due_on, due_time, position, source, agent_label, changed_source, changed_agent_label, created_at, updated_at, completed_at, deleted_at";

// The kinds an item is written as. The database's enum still names `link` and `review`, which a check refuses on every
// write since their rows became notes and tasks (20261031010000).
export const itemTypes = ["task", "note", "decision"] as const;
export type ItemType = (typeof itemTypes)[number];

// Who wrote: by hand, the chat, an agent, or the daily review (which only completes).
const sources = ["manual", "chat", "agent", "review"] as const;

export const itemSchema = z.object({
  id: z.string(),
  // The node it lives in, or null for General (a general task, a loose note).
  nodeId: z.string().nullable(),
  nodePath: z.string().nullable(),
  // The task it hangs from, or null when it hangs from its place.
  parentId: z.string().nullable(),
  type: z.enum(itemTypes),
  // A title or a note's text may carry links over its words: `[words](address)`.
  title: z.string(),
  body: z.string().nullable(),
  status: z.enum(["open", "done"]),
  priority: z.number().nullable(),
  dueOn: z.string().nullable(),
  // The hour of the due day, HH:MM on the person's clock.
  dueTime: z.string().nullable(),
  // The manual order: lower first.
  position: z.number(),
  source: z.enum(sources),
  agentLabel: z.string().nullable(),
  // Who made the last change: what completed it, renamed it, or deleted it.
  changedSource: z.enum(sources),
  changedAgentLabel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

export type Item = z.infer<typeof itemSchema>;

// Postgres answers a `time` as HH:MM:SS; the hour of a task is read and written as HH:MM.
export function hourOf(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

export function toItem(row: ItemRow, scope: Scope): Item {
  return {
    id: row.id,
    nodeId: row.node_id,
    nodePath: row.node_id === null ? null : (scope.all.get(row.node_id)?.path ?? ""),
    parentId: row.parent_item_id,
    type: row.type as ItemType,
    title: row.title,
    body: row.body,
    status: row.status,
    priority: row.priority,
    dueOn: row.due_on,
    dueTime: hourOf(row.due_time),
    position: Number(row.position),
    source: row.source,
    agentLabel: row.agent_label,
    changedSource: row.changed_source,
    changedAgentLabel: row.changed_agent_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    deletedAt: row.deleted_at,
  };
}

// The REST layer answers at most `max_rows` rows with a success status, so a list that must be whole is read page by
// page until a short page arrives. The page must not exceed the project's `max_rows` (1000 on this project, read from
// the Management API's PostgREST configuration): a smaller server cap would end the loop early without an error.
const PAGE = 1000;

// The rows of the reach: those of its nodes, and those of no node when it reaches General. Every read is the owner's too, so
// the server's key, which no policy filters, reaches no one else's rows.
export async function selectAllItems(
  ctx: ToolContext,
  reach: Reach,
  narrow: (query: ItemQuery) => ItemQuery,
  what: string,
): Promise<ToolResult<{ rows: ItemRow[] }>> {
  const rows: ItemRow[] = [];
  // The nodes and General are read as two parts, so a reader's own `or` filter never meets another one on the same query.
  const parts: Array<(query: ItemQuery) => ItemQuery> = [];
  if (reach.nodeIds.length > 0) parts.push((query) => query.in("node_id", reach.nodeIds));
  if (reach.general) parts.push((query) => query.is("node_id", null));
  for (const part of parts) {
    for (let from = 0; ; from += PAGE) {
      const query = narrow(part(baseQuery(ctx).eq("owner_id", ctx.ownerId)));
      const { data, error } = await query.order("id").range(from, from + PAGE - 1);
      if (error) return dbFail(what, error);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
  }
  return ok({ rows });
}

function baseQuery(ctx: ToolContext) {
  return ctx.db.from("items").select(ITEM_COLUMNS);
}

export type ItemQuery = ReturnType<typeof baseQuery>;

// What is open counts in its node and in every ancestor inside the scope, so a node's figure is its whole subtree; a row of
// no node counts only in the total. The one walk the tree's counts and the board's figures share: a node shows the same
// number in the sidebar and on its card.
export function countInSubtrees<K extends string>(
  rows: ItemRow[],
  scope: Scope,
  inScope: ReadonlySet<string>,
  keys: readonly K[],
  classify: (row: ItemRow) => K[],
): { total: Record<K, number>; perNode: Map<string, Record<K, number>> } {
  const zero = () => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  const total = zero();
  const perNode = new Map<string, Record<K, number>>([...inScope].map((id) => [id, zero()]));
  for (const row of rows) {
    const counted = classify(row);
    for (const key of counted) total[key]++;
    for (let id: string | null = row.node_id; id && inScope.has(id); id = scope.all.get(id)?.parentId ?? null) {
      const entry = perNode.get(id)!;
      for (const key of counted) entry[key]++;
    }
  }
  return { total, perNode };
}

// Open tasks first by priority (1 is the most urgent, none last), then by due date (none last).
export function byPriorityThenDue(a: Item, b: Item): number {
  const pa = a.priority ?? 9;
  const pb = b.priority ?? 9;
  if (pa !== pb) return pa - pb;
  const da = a.dueOn ?? "9999-12-31";
  const db = b.dueOn ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  // Two items written in one statement share their moment: the id keeps them in the same place on every read.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function newestFirst(a: Item, b: Item): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
