import { NextResponse, type NextRequest } from "next/server";
import { connectAccount } from "@/lib/google/connect";
import { googleDeps } from "@/lib/google/deps";
import { NONCE_COOKIE, verifyState } from "@/lib/google/state";
import { serverEnv } from "@/lib/env";
import { SESSION_HEADERS } from "@/lib/http";
import { readSession, userClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const back = (nodeId: string | null, outcome: string) => {
    const target = new URL(nodeId ? `/app/node/${nodeId}` : "/app", url.origin);
    target.searchParams.set("google", outcome);
    const response = NextResponse.redirect(target, { headers: SESSION_HEADERS });
    response.cookies.delete({ name: NONCE_COOKIE, path: "/api/google" });
    return response;
  };

  const deps = await googleDeps();
  const secret = serverEnv("TOKEN_ENCRYPTION_KEY");
  if (!deps || !secret) return back(null, "not-configured");
  const state = await verifyState(secret, url.searchParams.get("state") ?? "");
  if (!state || state.nonce !== request.cookies.get(NONCE_COOKIE)?.value) return back(null, "invalid-state");
  const session = await readSession(await userClient());
  if (session.kind === "unavailable") return back(state.nodeId, "failed");
  if (session.kind === "none" || session.user.id !== state.userId) return back(null, "invalid-state");
  const { user } = session;
  if (url.searchParams.get("error")) return back(state.nodeId, "cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back(state.nodeId, "cancelled");

  const node = await deps.service.from("nodes").select("id").eq("id", state.nodeId).eq("owner_id", user.id).maybeSingle();
  if (node.error || !node.data) return back(null, "invalid-state");
  try {
    await connectAccount(deps, { ownerId: user.id, nodeId: state.nodeId }, code, new URL("/api/google/callback", url.origin).toString());
  } catch (error) {
    console.error("google callback:", error instanceof Error ? error.message : error);
    return back(state.nodeId, "failed");
  }
  return back(state.nodeId, "connected");
}
