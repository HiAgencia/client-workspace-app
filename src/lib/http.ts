// Every answer that depends on a session is private and never cached, so "back" after signing out shows nothing.
export const SESSION_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...SESSION_HEADERS, ...headers } });
}

export function problem(status: number, message: string): Response {
  return json({ ok: false, message }, status);
}

// A request that changes state on a session must come from this site's own pages.
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  return origin === new URL(request.url).origin;
}

// Where to land after signing in: only a path on this site, never another origin.
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
