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
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  // The host the client used is the one its origin must match: behind a proxy the request's own URL may carry an
  // internal host (wrangler dev serves `localhost` while the browser is on `127.0.0.1`).
  const host = request.headers.get("host");
  if (host && parsed.host === host) return true;
  return origin === new URL(request.url).origin;
}

// Where to land after signing in: only a path on this site, never another origin. Decided by the URL parser itself,
// which strips tabs and line breaks, so "/\t/evil.com" resolves to another host and is refused.
export function safeNext(value: string | null, origin: string): string {
  if (!value) return "/";
  try {
    const target = new URL(value, origin);
    return target.origin === origin ? `${target.pathname}${target.search}` : "/";
  } catch {
    return "/";
  }
}
