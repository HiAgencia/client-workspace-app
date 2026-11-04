import type { Db } from "@/lib/db/client";
import { hashAgentToken, looksLikeAgentToken } from "@/lib/agent-token";

export type AgentAccess = {
  tokenId: string;
  nodeId: string;
  ownerId: string;
  label: string;
  lastReadAt: string | null;
};

export type AuthOutcome = { ok: true; access: AgentAccess } | { ok: false; status: 401 | 403 | 503; message: string };

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

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
    return { ok: false, status: 503, message: "the token could not be checked: try again" };
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
