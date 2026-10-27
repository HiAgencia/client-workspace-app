import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl } from "@/lib/google/connect";
import { googleDeps, missingGoogleConfig } from "@/lib/google/deps";
import { NONCE_COOKIE, newNonce, signState } from "@/lib/google/state";
import { serverEnv } from "@/lib/env";
import { problem, SESSION_HEADERS } from "@/lib/http";
import { currentUser, userClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tools/tree";

// Starts connecting a Google account to a node: the person must own the node, and the browser that starts the flow
// keeps a nonce the callback compares with the signed state.
export async function GET(request: NextRequest) {
  const nodeId = request.nextUrl.searchParams.get("node") ?? "";
  if (!isUuid(nodeId)) return problem(400, "say which node the account hangs from");
  const db = await userClient();
  const user = await currentUser(db);
  if (!user) return problem(401, "sign in first");
  if (user.isAnonymous) return problem(403, "the demo shows its own accounts: sign in with Google to connect yours");
  const deps = await googleDeps();
  if (!deps) return problem(503, `connecting accounts is not configured: ${missingGoogleConfig().join(", ")}`);
  const { data: node, error } = await db.from("nodes").select("id").eq("id", nodeId).maybeSingle();
  if (error) return problem(500, "the node could not be read");
  if (!node) return problem(404, "no such node");

  const nonce = newNonce();
  const state = await signState(serverEnv("TOKEN_ENCRYPTION_KEY")!, { nodeId, userId: user.id, nonce });
  const redirectUri = new URL("/api/google/callback", request.nextUrl.origin).toString();
  const response = NextResponse.redirect(authorizationUrl(deps.client.clientId, redirectUri, state), {
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
