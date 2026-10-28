import { type NextRequest } from "next/server";
import { z } from "zod";
import { hashAgentToken, mcpJson, newAgentToken, TOKEN_ENV } from "@/lib/agent-token";
import { json, problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { currentUser, userClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tools/tree";

// Agent tokens: every token of the person, or one node's, issuing one (shown once, stored as its hash), and revoking one.
// Everything runs as the signed-in person under row-level security, which never exposes a hash.
export async function GET(request: NextRequest) {
  const nodeId = request.nextUrl.searchParams.get("node");
  if (nodeId !== null && !isUuid(nodeId)) return problem(400, "no such node");
  const db = await userClient();
  if (!(await currentUser(db))) return problem(401, "not signed in");
  const query = db.from("agent_tokens").select("id, node_id, label, created_at, last_used_at, revoked_at");
  const { data, error } = await (nodeId ? query.eq("node_id", nodeId) : query).order("created_at", { ascending: false });
  if (error) {
    console.error("agent tokens:", error.message);
    return problem(500, "the tokens could not be read");
  }
  return json({
    ok: true,
    tokenEnv: TOKEN_ENV,
    mcpJson: mcpJson(new URL("/api/mcp", request.nextUrl.origin).toString()),
    tokens: data.map((row) => ({
      id: row.id,
      nodeId: row.node_id,
      label: row.label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    })),
  });
}

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue"), nodeId: z.uuid(), label: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("revoke"), id: z.uuid() }),
]);

export async function POST(request: Request) {
  const input = await readInput(request, action);
  if (!input.ok) return input.response;
  const db = await userClient();
  if (!(await currentUser(db))) return problem(401, "not signed in");
  const value = input.value;
  if (value.action === "issue") {
    const token = newAgentToken();
    const { data, error } = await db
      .from("agent_tokens")
      .insert({ node_id: value.nodeId, label: value.label, token_hash: await hashAgentToken(token) })
      .select("id")
      .single();
    if (error) {
      console.error("issue token:", error.message);
      return problem(422, "a token cannot be issued for that node");
    }
    return json({ ok: true, id: data.id, token });
  }
  const { data, error } = await db
    .from("agent_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", value.id)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    console.error("revoke token:", error.message);
    return problem(500, "the token could not be revoked");
  }
  if (data.length === 0) return problem(404, "no such active token");
  return json({ ok: true });
}
