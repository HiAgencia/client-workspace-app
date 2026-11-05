import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/$/, /^\/help$/, /^\/privacy$/, /^\/cookies$/, /^\/terms$/, /^\/es$/, /^\/es\/(help|privacy|cookies|terms)$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PUBLIC.some((pattern) => pattern.test(pathname))) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set("x-brief-lang", pathname === "/es" || pathname.startsWith("/es/") ? "es" : "en");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/", "/help", "/privacy", "/cookies", "/terms", "/es", "/es/help", "/es/privacy", "/es/cookies", "/es/terms"],
};
