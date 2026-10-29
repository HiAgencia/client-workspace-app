import { z } from "zod";
import { NODE_COLORS } from "@/lib/node-colors";
import type { ToolContext } from "./context";
import { dbFail, fail, isError, ok, type ToolResult } from "./result";
import { forgetScope, loadScope, resolveNode } from "./tree";

// Shaping the tree is done by hand on screen: creating a node in place, renaming it, giving it a color, archiving it. These are not
// offered to models; a node a model needs is created by the person, who sees where it lands.

// A root is a client or a project of the person's own, said by `kind`; below a node the kind follows its parent: a
// client's child is a project, a project's or a subproject's child is a subproject.
export const createNodeInput = z
  .strictObject({
    parent: z.string().min(1).optional(),
    kind: z.enum(["client", "project"]).optional(),
    name: z.string().trim().min(1).max(200),
  })
  .refine((value) => !(value.parent && value.kind), { message: "a node below another takes its kind from its parent" });

export async function createNode(
  ctx: ToolContext,
  input: z.infer<typeof createNodeInput>,
): Promise<ToolResult<{ node: { id: string; name: string; kind: string; parentId: string | null } }>> {
  let parentId: string | null = null;
  let kind: "client" | "project" | "subproject" = input.kind ?? "client";
  if (input.parent) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const parent = resolveNode(loaded.scope, input.parent);
    if (isError(parent)) return parent;
    parentId = parent.node.id;
    kind = parent.node.kind === "client" ? "project" : "subproject";
  } else if (ctx.scopeNodeId) {
    return fail("not_found", "a scoped access cannot create a node at the root");
  }
  const siblings = ctx.db.from("nodes").select("position").eq("owner_id", ctx.ownerId);
  const { data: last, error: positionError } = await (parentId ? siblings.eq("parent_id", parentId) : siblings.is("parent_id", null))
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (positionError) return dbFail("placing the node", positionError);
  const { data, error } = await ctx.db
    .from("nodes")
    .insert({ owner_id: ctx.ownerId, parent_id: parentId, kind, name: input.name, position: (last?.position ?? -1) + 1 })
    .select("id, name, kind, parent_id")
    .single();
  if (error) return dbFail("creating the node", error);
  forgetScope(ctx);
  return ok({ node: { id: data.id, name: data.name, kind: data.kind, parentId: data.parent_id } });
}

export const changeNodeInput = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
    // A color of the product's palette, or null for none: the node then shows its nearest ancestor's.
    color: z.enum(NODE_COLORS).nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.archived !== undefined || value.color !== undefined, { message: "nothing to change" });

export async function changeNode(
  ctx: ToolContext,
  id: string,
  input: z.infer<typeof changeNodeInput>,
): Promise<ToolResult<{ node: { id: string; name: string; archived: boolean; color: string | null } }>> {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  // An archived node is out of the loaded tree, so restoring one is looked up directly by owner.
  if (input.archived !== false) {
    const resolved = resolveNode(loaded.scope, id);
    if (isError(resolved)) return resolved;
  }
  const patch: { name?: string; archived_at?: string | null; color?: string | null } = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color;
  if (input.archived !== undefined) patch.archived_at = input.archived ? new Date().toISOString() : null;
  const { data, error } = await ctx.db
    .from("nodes")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ctx.ownerId)
    .select("id, name, archived_at, color")
    .maybeSingle();
  if (error) return dbFail("changing the node", error);
  if (!data) return fail("not_found", `no node with id ${id} is reachable here`);
  forgetScope(ctx);
  return ok({ node: { id: data.id, name: data.name, archived: data.archived_at !== null, color: data.color } });
}
