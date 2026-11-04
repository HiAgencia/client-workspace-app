import type { Db } from "@/lib/db/client";
import type { CalendarWriter, EventsSource } from "@/lib/tools/context";
import type { CalendarEvent } from "@/lib/tools/events-source";
import { deleteEvent, GoogleError, insertEvent, listEvents, patchEvent, refreshAccessToken, type Fetch, type GoogleEvent, type OAuthClient } from "./api";
import { decrypt, encrypt } from "./crypto";

const RENEW_MARGIN_MS = 60_000;

export type GoogleDeps = {
  service: Db;
  key: CryptoKey;
  client: OAuthClient;
  fetch: Fetch;
};

export type TokenRow = {
  id: string;
  email: string;
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
};

async function accessTokenFor(deps: GoogleDeps, account: TokenRow, now = Date.now(), renew = false): Promise<string> {
  const expires = account.access_token_expires_at ? Date.parse(account.access_token_expires_at) : 0;
  if (!renew && account.access_token && expires - RENEW_MARGIN_MS > now) return decrypt(deps.key, account.access_token);
  if (!account.refresh_token) throw new GoogleError("the account has no refresh token: connect it again", 0, "invalid_grant");
  let answer;
  try {
    answer = await refreshAccessToken(deps.fetch, deps.client, await decrypt(deps.key, account.refresh_token));
  } catch (error) {
    if (error instanceof GoogleError && error.revoked) {
      const marked = await deps.service.from("google_accounts").update({ status: "revoked" }).eq("id", account.id);
      if (marked.error) console.error("google: marking a revoked account failed", marked.error.message);
    }
    throw error;
  }
  const expiresAt = new Date(now + answer.expires_in * 1000).toISOString();
  const { error } = await deps.service
    .from("google_accounts")
    .update({
      access_token: await encrypt(deps.key, answer.access_token),
      access_token_expires_at: expiresAt,
      status: "active",
      ...(answer.refresh_token ? { refresh_token: await encrypt(deps.key, answer.refresh_token) } : {}),
    })
    .eq("id", account.id);
  if (error) throw new Error(`storing the renewed token: ${error.message}`);
  return answer.access_token;
}

export async function withAccessToken<T>(deps: GoogleDeps, account: TokenRow, call: (token: string) => Promise<T>): Promise<T> {
  const token = await accessTokenFor(deps, account);
  try {
    return await call(token);
  } catch (error) {
    if (!(error instanceof GoogleError) || error.status !== 401) throw error;
    return call(await accessTokenFor(deps, account, Date.now(), true));
  }
}

function toEvent(
  event: GoogleEvent,
  calendar: { calendar_id: string; summary: string; color: string | null },
  account: { id: string; email: string },
  fromNodeId: string,
): CalendarEvent | null {
  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (!start || !end || event.status === "cancelled") return null;
  return {
    id: event.id,
    title: event.summary ?? "(no title)",
    start,
    end,
    allDay: !event.start?.dateTime,
    location: event.location ?? null,
    link: event.htmlLink ?? null,
    calendarId: calendar.calendar_id,
    calendarName: calendar.summary,
    color: calendar.color,
    accountId: account.id,
    accountEmail: account.email,
    fromNodeId,
  };
}

const REVOKED = "access was revoked: connect the account again";

export function googleEventsSource(deps: GoogleDeps): EventsSource {
  return async ({ ownerId, account, nodeId, from, to }) => {
    if (account.isDemo) return { events: [], failures: [] };
    const failed = (reason: string) => ({ events: [], failures: [{ accountId: account.id, accountEmail: account.email, reason }] });
    if (account.status === "revoked") return failed(REVOKED);

    const tokens = await deps.service
      .from("google_accounts")
      .select("id, email, refresh_token, access_token, access_token_expires_at")
      .eq("id", account.id)
      .eq("owner_id", ownerId)
      .eq("is_demo", false)
      .maybeSingle();
    if (tokens.error) throw new Error(`reading the account: ${tokens.error.message}`);
    const row = tokens.data;
    if (!row) return { events: [], failures: [] };
    const calendars = await deps.service.from("account_calendars").select("calendar_id, summary, color").eq("selected", true).eq("account_id", account.id);
    if (calendars.error) throw new Error(`reading the calendars: ${calendars.error.message}`);
    const chosen = calendars.data;
    if (chosen.length === 0) return { events: [], failures: [] };

    try {
      const events = await withAccessToken(deps, row, async (token) => {
        const found: CalendarEvent[] = [];
        for (const calendar of chosen) {
          for (const item of await listEvents(deps.fetch, token, calendar.calendar_id, from, to)) {
            const event = toEvent(item, calendar, row, nodeId);
            if (event) found.push(event);
          }
        }
        return found;
      });
      return { events: events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), failures: [] };
    } catch (error) {
      return failed(error instanceof GoogleError && error.revoked ? REVOKED : error instanceof Error ? error.message : "the account could not be read");
    }
  };
}

export function demoEventsSource(): EventsSource {
  const reads = new Map<string, ReturnType<typeof readDemoCalendars>>();
  return async ({ db, ownerId, account, nodeId, from, to }) => {
    const key = `${from}|${to}`;
    const read = reads.get(key) ?? readDemoCalendars(db, ownerId, from, to);
    reads.set(key, read);
    const rows = await read;
    const events = rows
      .filter((row) => row.account_id === account.id)
      .map(
        (row): CalendarEvent => ({
          id: row.google_id,
          title: row.title,
          start: row.starts_at,
          end: row.ends_at,
          allDay: false,
          location: row.location,
          link: null,
          calendarId: "primary",
          calendarName: row.calendar_name,
          color: null,
          accountId: row.account_id,
          accountEmail: account.email,
          fromNodeId: nodeId,
        }),
      );
    return { events, failures: [] };
  };
}

async function readDemoCalendars(db: Db, ownerId: string, from: string, to: string) {
  const { data, error } = await db
    .from("demo_events")
    .select("google_id, account_id, calendar_name, title, location, starts_at, ends_at")
    .eq("owner_id", ownerId)
    .lt("starts_at", to)
    .gt("ends_at", from)
    .order("starts_at");
  if (error) throw new Error(`reading the sample calendars: ${error.message}`);
  return data;
}

export function googleCalendarWriter(deps: GoogleDeps): CalendarWriter {
  async function accountFor(ownerId: string, accountId: string) {
    const { data, error } = await deps.service
      .from("google_accounts")
      .select("id, email, status, is_demo, refresh_token, access_token, access_token_expires_at")
      .eq("id", accountId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(`reading the account: ${error.message}`);
    if (!data) throw new GoogleError("no such account", 404, "not_found");
    if (data.is_demo) throw new GoogleError("the demo's sample account is read-only", 403, "read_only");
    if (data.status === "revoked") throw new GoogleError("access was revoked: connect the account again", 401, "invalid_grant");
    return data;
  }
  return {
    async create({ ownerId, accountId, calendarId, event }) {
      return withAccessToken(deps, await accountFor(ownerId, accountId), (token) => insertEvent(deps.fetch, token, calendarId, event));
    },
    async update({ ownerId, accountId, calendarId, eventId, event }) {
      return withAccessToken(deps, await accountFor(ownerId, accountId), (token) => patchEvent(deps.fetch, token, calendarId, eventId, event));
    },
    async remove({ ownerId, accountId, calendarId, eventId }) {
      await withAccessToken(deps, await accountFor(ownerId, accountId), (token) => deleteEvent(deps.fetch, token, calendarId, eventId));
    },
  };
}
