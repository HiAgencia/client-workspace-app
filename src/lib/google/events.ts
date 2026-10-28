import type { Db } from "@/lib/db/client";
import type { CalendarWriter, EventsSource } from "@/lib/tools/context";
import type { CalendarEvent, EventsFailure } from "@/lib/tools/events-source";
import { deleteEvent, GoogleError, insertEvent, listEvents, patchEvent, refreshAccessToken, type Fetch, type GoogleEvent, type OAuthClient } from "./api";
import { decrypt, encrypt } from "./crypto";

// A token that expires within this margin is renewed first, so it does not expire mid-request.
const RENEW_MARGIN_MS = 60_000;

export type GoogleDeps = {
  // The service client: the signed-in role never reads the token columns.
  service: Db;
  key: CryptoKey;
  client: OAuthClient;
  fetch: Fetch;
};

type AccountRow = {
  id: string;
  email: string;
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
};

// A valid access token for one account, renewed with its refresh token when needed and stored again encrypted.
// A revoked authorization marks the account so the screen can offer to connect it again.
export async function accessTokenFor(deps: GoogleDeps, account: AccountRow, now = Date.now()): Promise<string> {
  const expires = account.access_token_expires_at ? Date.parse(account.access_token_expires_at) : 0;
  if (account.access_token && expires - RENEW_MARGIN_MS > now) return decrypt(deps.key, account.access_token);
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

// The events of every account visible from a node, its own and those inherited from its ancestors, merged in time
// order. An account that fails is reported with its reason and the others still answer.
export function googleEventsSource(deps: GoogleDeps): EventsSource {
  return async ({ ownerId, nodeId, from, to }) => {
    const visible = await deps.service.rpc("visible_accounts", { node: nodeId });
    if (visible.error) throw new Error(`reading the node's accounts: ${visible.error.message}`);
    const fromNode = new Map(visible.data.map((row) => [row.account_id, row.from_node_id]));
    if (fromNode.size === 0) return { events: [], failures: [] };

    const accounts = await deps.service
      .from("google_accounts")
      .select("id, email, status, refresh_token, access_token, access_token_expires_at")
      .eq("owner_id", ownerId)
      .in("id", [...fromNode.keys()]);
    if (accounts.error) throw new Error(`reading the accounts: ${accounts.error.message}`);
    const calendars = await deps.service
      .from("account_calendars")
      .select("account_id, calendar_id, summary, color")
      .eq("selected", true)
      .in("account_id", accounts.data.map((account) => account.id));
    if (calendars.error) throw new Error(`reading the calendars: ${calendars.error.message}`);

    const events: CalendarEvent[] = [];
    const failures: EventsFailure[] = [];
    await Promise.all(
      accounts.data.map(async (account) => {
        // A revoked authorization is not asked again on every read: only connecting the account again fixes it.
        if (account.status === "revoked") {
          failures.push({ accountId: account.id, accountEmail: account.email, reason: "access was revoked: connect the account again" });
          return;
        }
        try {
          const token = await accessTokenFor(deps, account);
          const own = calendars.data.filter((calendar) => calendar.account_id === account.id);
          for (const calendar of own) {
            const items = await listEvents(deps.fetch, token, calendar.calendar_id, from, to);
            for (const item of items) {
              const event = toEvent(item, calendar, account, fromNode.get(account.id)!);
              if (event) events.push(event);
            }
          }
        } catch (error) {
          failures.push({
            accountId: account.id,
            accountEmail: account.email,
            reason: error instanceof GoogleError && error.revoked
              ? "access was revoked: connect the account again"
              : error instanceof Error
                ? error.message
                : "the account could not be read",
          });
        }
      }),
    );
    events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return { events, failures };
  };
}

// Writing to an account's calendar: the account must be the owner's, connected for real (not the demo's) and not revoked;
// its token is renewed as for reading.
export function googleCalendarWriter(deps: GoogleDeps): CalendarWriter {
  async function tokenFor(ownerId: string, accountId: string) {
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
    return accessTokenFor(deps, data);
  }
  return {
    async create({ ownerId, accountId, calendarId, event }) {
      return insertEvent(deps.fetch, await tokenFor(ownerId, accountId), calendarId, event);
    },
    async update({ ownerId, accountId, calendarId, eventId, event }) {
      return patchEvent(deps.fetch, await tokenFor(ownerId, accountId), calendarId, eventId, event);
    },
    async remove({ ownerId, accountId, calendarId, eventId }) {
      await deleteEvent(deps.fetch, await tokenFor(ownerId, accountId), calendarId, eventId);
    },
  };
}
