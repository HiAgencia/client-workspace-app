import { CALENDAR_LIST_SCOPE, CONNECT_SCOPES, EVENTS_SCOPE, exchangeCode, GMAIL_READ_SCOPE, GOOGLE_AUTH_URL, listCalendars, userEmail } from "./api";
import { encrypt } from "./crypto";
import type { GoogleDeps } from "./events";

export function authorizationUrl(clientId: string, redirectUri: string, state: string, loginHint?: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CONNECT_SCOPES.join(" "));
  // Offline access and a fresh consent so Google returns a refresh token every time an account is connected.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export type ConnectedAccount = { accountId: string; email: string; calendars: number };

// Trades the code for tokens, stores the account encrypted, hangs it from the node, and fills its calendars.
// Connecting an account that is already connected refreshes its tokens and adds the node.
export async function connectAccount(
  deps: GoogleDeps,
  target: { ownerId: string; nodeId: string },
  code: string,
  redirectUri: string,
): Promise<ConnectedAccount> {
  const tokens = await exchangeCode(deps.fetch, deps.client, code, redirectUri);
  if (!tokens.refresh_token) throw new Error("Google returned no refresh token: connect the account again");
  const scopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  // All three are needed: the events to read and write them, the calendar list to know which calendars there are, and the
  // mail to read it. Google lets the person untick each one on its consent screen.
  if (!scopes.includes(EVENTS_SCOPE) || !scopes.includes(CALENDAR_LIST_SCOPE)) {
    throw new Error("calendar access was not granted: tick both calendar permissions when connecting");
  }
  if (!scopes.includes(GMAIL_READ_SCOPE)) {
    throw new Error("mail access was not granted: tick the Gmail permission when connecting");
  }
  const profile = await userEmail(deps.fetch, tokens.access_token);
  if (!profile.email) throw new Error("Google did not share the account's email");

  const { data: account, error } = await deps.service
    .from("google_accounts")
    .upsert(
      {
        owner_id: target.ownerId,
        email: profile.email.toLowerCase(),
        refresh_token: await encrypt(deps.key, tokens.refresh_token),
        access_token: await encrypt(deps.key, tokens.access_token),
        access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes,
        status: "active",
      },
      { onConflict: "owner_id,email" },
    )
    .select("id, email")
    .single();
  if (error) throw new Error(`saving the account: ${error.message}`);

  const link = await deps.service
    .from("node_accounts")
    .upsert({ node_id: target.nodeId, account_id: account.id }, { onConflict: "node_id,account_id", ignoreDuplicates: true });
  if (link.error) throw new Error(`attaching the account: ${link.error.message}`);

  const calendars = await listCalendars(deps.fetch, tokens.access_token);
  if (calendars.length > 0) {
    const rows = calendars.map((calendar) => ({
      account_id: account.id,
      calendar_id: calendar.id,
      summary: calendar.summaryOverride ?? calendar.summary ?? calendar.id,
      color: calendar.backgroundColor ?? null,
      selected: calendar.primary === true || calendar.selected === true,
    }));
    // A calendar already present keeps the person's choice of showing it; only its name and color refresh.
    const existing = await deps.service.from("account_calendars").select("calendar_id").eq("account_id", account.id);
    if (existing.error) throw new Error(`reading the calendars: ${existing.error.message}`);
    const known = new Set(existing.data.map((row) => row.calendar_id));
    const fresh = rows.filter((row) => !known.has(row.calendar_id));
    if (fresh.length > 0) {
      const inserted = await deps.service.from("account_calendars").insert(fresh);
      if (inserted.error) throw new Error(`saving the calendars: ${inserted.error.message}`);
    }
    for (const row of rows.filter((r) => known.has(r.calendar_id))) {
      const updated = await deps.service
        .from("account_calendars")
        .update({ summary: row.summary, color: row.color })
        .eq("account_id", account.id)
        .eq("calendar_id", row.calendar_id);
      if (updated.error) throw new Error(`updating the calendars: ${updated.error.message}`);
    }
  }
  return { accountId: account.id, email: account.email, calendars: calendars.length };
}
