import { NextResponse, type NextRequest } from "next/server";
import { authorizeAccount, connectAccount, encryptAuthorized } from "@/lib/google/connect";
import { googleDeps } from "@/lib/google/deps";
import { linkIdOfState, NONCE_COOKIE, verifyLinkState, verifyState } from "@/lib/google/state";
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

  const rawState = url.searchParams.get("state") ?? "";
  const linkState = await verifyLinkState(secret, rawState);
  if (linkState || linkIdOfState(rawState)) {
    const done = (outcome: string) => NextResponse.redirect(new URL(`/connect/google/done?outcome=${outcome}`, url.origin), { headers: SESSION_HEADERS });
    if (!linkState) return done("invalid-link");
    if (url.searchParams.get("error")) return done("cancelled");
    const code = url.searchParams.get("code");
    if (!code) return done("cancelled");
    const { data: link, error } = await deps.service
      .from("google_connect_links")
      .select("id, status, expires_at")
      .eq("id", linkState.linkId)
      .maybeSingle();
    if (error || !link || link.status !== "pending" || Date.parse(link.expires_at) < Date.now()) return done("invalid-link");
    try {
      const authorized = await authorizeAccount(deps, code, new URL("/api/google/callback", url.origin).toString());
      const sealed = await encryptAuthorized(deps, authorized);
      const stored = await deps.service
        .from("google_connect_links")
        .update({ status: "authorized", ...sealed, authorized_at: new Date().toISOString() })
        .eq("id", link.id)
        .eq("status", "pending")
        .select("id");
      if (stored.error) throw new Error(stored.error.message);
      if (!stored.data || stored.data.length === 0) return done("invalid-link");
    } catch (caught) {
      console.error("google link callback:", caught instanceof Error ? caught.message : caught);
      return done("failed");
    }
    return done("authorized");
  }

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
