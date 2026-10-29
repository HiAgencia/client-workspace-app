import { z } from "zod";
import type { Database } from "@/lib/db/types";
import type { ToolContext } from "./context";
import { dbFail, ok, type ToolResult } from "./result";
import type { Reach, Scope } from "./tree";

type ItemRow = Database["public"]["Tables"]["items"]["Row"];

export const ITEM_COLUMNS =
  "id, owner_id, node_id, parent_item_id, type, title, body, status, priority, due_on, due_time, position, source, agent_label, changed_source, changed_agent_label, created_at, updated_at, completed_at, deleted_at";



export const itemTypes = ["task", "note", "decision"] as const;
export type ItemType = (typeof itemTypes)[number];


const sources = ["manual", "chat", "agent", "review"] as const;

export const itemSchema = z.object({
  id: z.string(),
  
  nodeId: z.string().nullable(),
  nodePath: z.string().nullable(),
  
  parentId: z.string().nullable(),
  type: z.enum(itemTypes),
  
  title: z.string(),
  body: z.string().nullable(),
  status: z.enum(["open", "done"]),
  priority: z.number().nullable(),
  dueOn: z.string().nullable(),
  
  dueTime: z.string().nullable(),
  
  position: z.number(),
  source: z.enum(sources),
  agentLabel: z.string().nullable(),
  
  changedSource: z.enum(sources),
  changedAgentLabel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

export type Item = z.infer<typeof itemSchema>;


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




const PAGE = 1000;



export async function selectAllItems(
  ctx: ToolContext,
  reach: Reach,
  narrow: (query: ItemQuery) => ItemQuery,
  what: string,
): Promise<ToolResult<{ rows: ItemRow[] }>> {
  const rows: ItemRow[] = [];
  
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


export function byPriorityThenDue(a: Item, b: Item): number {
  const pa = a.priority ?? 9;
  const pb = b.priority ?? 9;
  if (pa !== pb) return pa - pb;
  const da = a.dueOn ?? "9999-12-31";
  const db = b.dueOn ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function newestFirst(a: Item, b: Item): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
