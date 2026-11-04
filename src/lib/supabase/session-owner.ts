const SESSION_COOKIE = /^sb-[a-z0-9]+-auth-token(?:\.(\d+))?$/;

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function sessionOwner(cookies: Array<{ name: string; value: string }>): string | null {
  return sessionCookieUser(cookies)?.id ?? null;
}

export function sessionCookieUser(cookies: Array<{ name: string; value: string }>): { id: string; isAnonymous: boolean } | null {
  const parts = cookies
    .flatMap((cookie) => {
      const match = SESSION_COOKIE.exec(cookie.name);
      return match ? [{ index: match[1] === undefined ? -1 : Number(match[1]), value: cookie.value }] : [];
    })
    .sort((a, b) => a.index - b.index);
  if (parts.length === 0) return null;
  const whole = parts.find((part) => part.index === -1);
  let raw = whole ? whole.value : parts.map((part) => part.value).join("");
  try {
    raw = decodeURIComponent(raw);
    const json = raw.startsWith("base64-") ? fromBase64Url(raw.slice("base64-".length)) : raw;
    const session = JSON.parse(json) as { user?: { id?: unknown; is_anonymous?: unknown } } | null;
    return typeof session?.user?.id === "string" ? { id: session.user.id, isAnonymous: session.user.is_anonymous === true } : null;
  } catch {
    return null;
  }
}

export function documentCookies(): Array<{ name: string; value: string }> {
  try {
    return document.cookie
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const at = part.indexOf("=");
        return { name: at < 0 ? part : part.slice(0, at), value: at < 0 ? "" : part.slice(at + 1) };
      });
  } catch {
    return [];
  }
}
