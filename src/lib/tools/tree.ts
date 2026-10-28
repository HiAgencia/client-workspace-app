import type { Database } from "@/lib/db/types";
import type { ToolContext } from "./context";
import { dbFail, fail, ok, type ToolResult } from "./result";

export type NodeKind = Database["public"]["Enums"]["node_kind"];

export type TreeNode = {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  name: string;
  position: number;
  createdAt: string;
  path: string;
  segments: string[];
};

// The owner's whole tree and the part of it the caller may reach.
export type Scope = {
  all: Map<string, TreeNode>;
  reachable: Set<string>;
  root: TreeNode | null;
};

export const PATH_SEPARATOR = " / ";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

// Case and accents do not tell two names apart: "Diseño" and "diseno" are the same node.
export function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitPath(path: string): string[] {
  return path
    .split("/")
    .map((segment) => normalizeName(segment))
    .filter((segment) => segment.length > 0);
}

// One read of the tree per context: a chat turn or a request that calls several tools reads it once. Items do not
// change the tree; shaping it (create, rename, archive) forgets the read.
const scopes = new WeakMap<ToolContext, Promise<ToolResult<{ scope: Scope }>>>();

export function loadScope(ctx: ToolContext): Promise<ToolResult<{ scope: Scope }>> {
  let pending = scopes.get(ctx);
  if (!pending) {
    pending = readScope(ctx);
    scopes.set(ctx, pending);
    // A failed read is not kept: the next tool asks again.
    pending.then(
      (result) => {
        if (!result.ok) scopes.delete(ctx);
      },
      () => scopes.delete(ctx),
    );
  }
  return pending;
}

export function forgetScope(ctx: ToolContext): void {
  scopes.delete(ctx);
}

async function readScope(ctx: ToolContext): Promise<ToolResult<{ scope: Scope }>> {
  const { data, error } = await ctx.db
    .from("nodes")
    .select("id, parent_id, kind, name, position, created_at")
    .eq("owner_id", ctx.ownerId)
    .is("archived_at", null)
    .order("position")
    .order("name");
  if (error) return dbFail("reading the tree", error);

  const all = new Map<string, TreeNode>();
  for (const row of data) {
    all.set(row.id, {
      id: row.id,
      parentId: row.parent_id,
      kind: row.kind,
      name: row.name,
      position: row.position,
      createdAt: row.created_at,
      path: "",
      segments: [],
    });
  }
  // Archiving a node archives what hangs from it: a node whose chain does not reach a root through live nodes leaves
  // the tree, so it is reached neither by id nor by a cut path.
  for (const node of [...all.values()]) {
    const names: string[] = [];
    let cursor: TreeNode | undefined = node;
    let rooted = false;
    // The depth bound guards against a corrupt cycle.
    for (let depth = 0; cursor && depth < 64; depth++) {
      names.unshift(cursor.name);
      if (cursor.parentId === null) {
        rooted = true;
        break;
      }
      cursor = all.get(cursor.parentId);
    }
    if (!rooted) {
      all.delete(node.id);
      continue;
    }
    node.path = names.join(PATH_SEPARATOR);
    node.segments = names.map(normalizeName);
  }

  if (!ctx.scopeNodeId) {
    return ok({ scope: { all, reachable: new Set(all.keys()), root: null } });
  }
  const root = all.get(ctx.scopeNodeId);
  if (!root) return fail("not_found", "the node this access is scoped to no longer exists");
  return ok({ scope: { all, reachable: subtree(all, root.id), root } });
}

export function subtree(all: Map<string, TreeNode>, rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of all.values()) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const ids = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return ids;
}

export function describeNode(node: TreeNode) {
  return { id: node.id, path: node.path, kind: node.kind };
}

// A node is addressed by id or by its readable path. A path may be written whole ("Acme / Web / Landing") or by its
// last segments ("Web / Landing"); a whole match wins, and several partial ones are returned as candidates.
export function resolveNode(scope: Scope, ref: string | undefined): ToolResult<{ node: TreeNode }> {
  if (ref === undefined || ref.trim() === "") {
    if (scope.root) return ok({ node: scope.root });
    return fail("node_required", "say which node: its id or its path, such as \"Acme / Web\"");
  }
  const value = ref.trim();
  if (isUuid(value)) {
    const node = scope.all.get(value.toLowerCase());
    if (node && scope.reachable.has(node.id)) return ok({ node });
    return fail("not_found", `no node with id ${value} is reachable here`);
  }

  const wanted = splitPath(value);
  if (wanted.length === 0) return fail("invalid_input", "the node path is empty");
  const reachable = [...scope.reachable].map((id) => scope.all.get(id)!);
  const whole = reachable.filter(
    (node) => node.segments.length === wanted.length && node.segments.every((segment, i) => segment === wanted[i]),
  );
  if (whole.length === 1) return ok({ node: whole[0] });
  const partial = reachable.filter((node) => {
    if (node.segments.length < wanted.length) return false;
    const tail = node.segments.slice(node.segments.length - wanted.length);
    return tail.every((segment, i) => segment === wanted[i]);
  });
  if (partial.length === 1) return ok({ node: partial[0] });
  if (partial.length === 0) return fail("not_found", `no node matches "${value}" here`);
  return fail("ambiguous", `"${value}" matches ${partial.length} nodes: pick one by id`, {
    ambiguous: true,
    candidates: partial.map(describeNode),
  });
}
