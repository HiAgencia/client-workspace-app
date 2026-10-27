import { NextResponse, type NextRequest } from "next/server";
import { safeNext, SESSION_HEADERS } from "@/lib/http";
import { userClient } from "@/lib/supabase/server";

// Google sends the person back here through Supabase with a one-time code; trading it for a session writes the
// session cookies on this response.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), url.origin);
  const failed = new URL("/", url.origin);
  failed.searchParams.set("auth", "failed");

  if (!code) return NextResponse.redirect(failed, { headers: SESSION_HEADERS });
  const db = await userClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("auth callback: code exchange failed", error.code ?? error.name);
    return NextResponse.redirect(failed, { headers: SESSION_HEADERS });
  }
  return NextResponse.redirect(new URL(next, url.origin), { headers: SESSION_HEADERS });
}
