import { NextResponse, type NextRequest } from "next/server";
import { authorizationUrl } from "@/lib/google/connect";
import { hashLinkToken } from "@/lib/google/connect-links";
import { googleDeps } from "@/lib/google/deps";
import { signLinkState } from "@/lib/google/state";
import { serverEnv } from "@/lib/env";
import { SESSION_HEADERS } from "@/lib/http";
import { serviceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = request.nextUrl.origin;
  const done = (outcome: string) => NextResponse.redirect(new URL(`/connect/google/done?outcome=${outcome}`, origin), { headers: SESSION_HEADERS });
  const deps = await googleDeps();
  const secret = serverEnv("TOKEN_ENCRYPTION_KEY");
  if (!deps || !secret) return done("not-configured");
  const service = serviceClient();
  const { data: link, error } = await service
    .from("google_connect_links")
    .select("id, status, expires_at")
    .eq("token_hash", await hashLinkToken(token))
    .maybeSingle();
  if (error || !link) return done("invalid-link");
  if (link.status !== "pending" || Date.parse(link.expires_at) < Date.now()) {
    await service.from("google_connect_links").update({ status: "cancelled", refresh_token: null, access_token: null }).eq("id", link.id).in("status", ["pending", "authorized"]);
    return done("invalid-link");
  }
  const state = await signLinkState(secret, link.id, Date.parse(link.expires_at));
  const redirectUri = new URL("/api/google/callback", origin).toString();
  return NextResponse.redirect(authorizationUrl(deps.client.clientId, redirectUri, state), { headers: SESSION_HEADERS });
}
