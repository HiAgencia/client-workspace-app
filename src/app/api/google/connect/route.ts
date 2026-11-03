import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl } from "@/lib/google/connect";
import { googleDeps, missingGoogleConfig } from "@/lib/google/deps";
import { NONCE_COOKIE, newNonce, signState } from "@/lib/google/state";
import { serverEnv } from "@/lib/env";
import { problem, SESSION_HEADERS } from "@/lib/http";
import { requireUser, userClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tools/tree";




export async function GET(request: NextRequest) {
  const nodeId = request.nextUrl.searchParams.get("node") ?? "";
  const asSession = request.nextUrl.searchParams.get("as") === "session";
  if (!isUuid(nodeId)) return problem(400, "say which node the account hangs from");
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who.response;
  const { user } = who;
  if (user.isAnonymous) return problem(403, "the demo does not connect Google accounts: sign in with Google to connect yours");
  const deps = await googleDeps();
  if (!deps) return problem(503, `connecting accounts is not configured: ${missingGoogleConfig().join(", ")}`);
  const { data: node, error } = await db.from("nodes").select("id").eq("id", nodeId).maybeSingle();
  if (error) return problem(500, "the node could not be loaded");
  if (!node) return problem(404, "no such node");

  const nonce = newNonce();
  const state = await signState(serverEnv("TOKEN_ENCRYPTION_KEY")!, { nodeId, userId: user.id, nonce });
  const redirectUri = new URL("/api/google/callback", request.nextUrl.origin).toString();
  const loginHint = asSession ? (user.email ?? undefined) : undefined;
  const response = NextResponse.redirect(authorizationUrl(deps.client.clientId, redirectUri, state, loginHint), {
    headers: SESSION_HEADERS,
  });
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/google",
    maxAge: 600,
  });
  return response;
}
