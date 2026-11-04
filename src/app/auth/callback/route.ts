import { NextResponse, type NextRequest } from "next/server";
import { safeNext, SESSION_HEADERS } from "@/lib/http";
import { userClient } from "@/lib/supabase/server";

const AFTER_SIGN_IN = "/app/resume";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const asked = url.searchParams.get("next");
  const next = asked ? safeNext(asked, url.origin) : AFTER_SIGN_IN;
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
