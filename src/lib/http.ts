
export const SESSION_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...SESSION_HEADERS, ...headers } });
}

export function problem(status: number, message: string): Response {
  return json({ ok: false, message }, status);
}


export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  
  
  const host = request.headers.get("host");
  if (host && parsed.host === host) return true;
  return origin === new URL(request.url).origin;
}



export function safeNext(value: string | null, origin: string): string {
  if (!value) return "/";
  try {
    const target = new URL(value, origin);
    return target.origin === origin ? `${target.pathname}${target.search}` : "/";
  } catch {
    return "/";
  }
}
