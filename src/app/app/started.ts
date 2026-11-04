import { documentCookies, sessionCookieUser, sessionOwner } from "@/lib/supabase/session-owner";

export const STARTED_COOKIE = "cw_started";

export function startedFor(value: string | undefined, owner: string | null): boolean {
  return owner !== null && value === owner;
}

export function markStarted(started: boolean): void {
  const owner = sessionOwner(documentCookies());
  if (!owner) return;
  const now = documentCookies().find((cookie) => cookie.name === STARTED_COOKIE)?.value;
  if (started && now !== owner) document.cookie = `${STARTED_COOKIE}=${owner}; path=/; max-age=31536000; samesite=lax`;
  if (!started && now !== undefined) document.cookie = `${STARTED_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function settledInBrowser(): boolean {
  const cookies = documentCookies();
  const session = sessionCookieUser(cookies);
  return session?.isAnonymous === true || startedFor(cookies.find((cookie) => cookie.name === STARTED_COOKIE)?.value, session?.id ?? null);
}
