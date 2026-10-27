import type { Db } from "@/lib/db/client";
import { hashAgentToken, looksLikeAgentToken } from "@/lib/agent-token";

export type AgentAccess = {
  tokenId: string;
  nodeId: string;
  ownerId: string;
  label: string;
  // When this token last asked for what is new: the default start of `get_updates_since`.
  lastReadAt: string | null;
};

export type AuthOutcome = { ok: true; access: AgentAccess } | { ok: false; status: 401 | 403; message: string };

// A browser page can be made to call a local server (DNS rebinding), so a request that carries an Origin must come
// from this site; a coding agent sends none.
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

// The token travels in `Authorization: Bearer`; only its SHA-256 is stored, and a revoked token, or one whose node
// is gone or archived, is refused like a missing one.
export async function authenticateAgent(request: Request, service: Db): Promise<AuthOutcome> {
  if (!originAllowed(request)) return { ok: false, status: 403, message: "requests from other sites are not accepted" };
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || !looksLikeAgentToken(token)) return { ok: false, status: 401, message: "a valid agent token is required" };
  const { data, error } = await service
    .from("agent_tokens")
    .select("id, node_id, label, last_used_at, revoked_at, nodes!inner(owner_id, archived_at)")
    .eq("token_hash", await hashAgentToken(token))
    .maybeSingle();
  if (error) {
    console.error("mcp auth:", error.message);
    return { ok: false, status: 401, message: "a valid agent token is required" };
  }
  if (!data || data.revoked_at || data.nodes.archived_at) {
    return { ok: false, status: 401, message: "a valid agent token is required" };
  }
  return {
    ok: true,
    access: {
      tokenId: data.id,
      nodeId: data.node_id,
      ownerId: data.nodes.owner_id,
      label: data.label,
      lastReadAt: data.last_used_at,
    },
  };
}
