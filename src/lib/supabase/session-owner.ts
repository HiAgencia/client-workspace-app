// Who the session cookie says is signed in, read without a call to the auth server: only to tell whose saved layout a
// page may paint, never to decide what someone can read or write (that is the auth server's, through `currentUser`).
// The session is in `sb-<project>-auth-token`, whole or in numbered chunks, as JSON or as `base64-` and base64url JSON.
const SESSION_COOKIE = /^sb-[a-z0-9]+-auth-token(?:\.(\d+))?$/;

// With the platform's own decoder, the same on the server and on a worker.
function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function sessionOwner(cookies: Array<{ name: string; value: string }>): string | null {
  const parts = cookies
    .flatMap((cookie) => {
      const match = SESSION_COOKIE.exec(cookie.name);
      return match ? [{ index: match[1] === undefined ? -1 : Number(match[1]), value: cookie.value }] : [];
    })
    .sort((a, b) => a.index - b.index);
  if (parts.length === 0) return null;
  // A whole cookie wins over chunks left from an earlier session.
  const whole = parts.find((part) => part.index === -1);
  let raw = whole ? whole.value : parts.map((part) => part.value).join("");
  try {
    raw = decodeURIComponent(raw);
    const json = raw.startsWith("base64-") ? fromBase64Url(raw.slice("base64-".length)) : raw;
    const session = JSON.parse(json) as { user?: { id?: unknown } } | null;
    return typeof session?.user?.id === "string" ? session.user.id : null;
  } catch {
    return null;
  }
}
