import { NextResponse, type NextRequest } from "next/server";
import { connectAccount } from "@/lib/google/connect";
import { googleDeps } from "@/lib/google/deps";
import { NONCE_COOKIE, verifyState } from "@/lib/google/state";
import { serverEnv } from "@/lib/env";
import { SESSION_HEADERS } from "@/lib/http";
import { currentUser, userClient } from "@/lib/supabase/server";

// Google sends the person back here. The state must be ours, fresh, for this signed-in person, and started in this
// browser; then the account is stored and the person lands on the node with the outcome in the address.
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
  const user = await currentUser(await userClient());
  if (!user || user.id !== state.userId) return back(null, "invalid-state");
  if (url.searchParams.get("error")) return back(state.nodeId, "cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back(state.nodeId, "cancelled");

  // The service client writes the account; the node is checked against the signed-in owner first.
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
