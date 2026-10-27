// The few Google endpoints the product calls, over a `fetch` the caller passes, so tests answer for Google.

export type Fetch = typeof fetch;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const CONNECT_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"];

// Every call to Google carries its own deadline: a slow answer is a failure of that account, not a hung request.
const TIMEOUT_MS = 10_000;

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(message);
  }
  // The person revoked the access or the refresh token expired: only connecting again fixes it.
  get revoked(): boolean {
    return this.reason === "invalid_grant";
  }
}

async function call<T>(fetcher: Fetch, url: string, init: RequestInit, what: string): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new GoogleError(`${what}: no answer (${error instanceof Error ? error.name : "network"})`, 0, null);
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const record = (body ?? {}) as { error?: string | { status?: string; message?: string } };
    const reason = typeof record.error === "string" ? record.error : (record.error?.status ?? null);
    throw new GoogleError(`${what}: HTTP ${response.status}${reason ? ` ${reason}` : ""}`, response.status, reason);
  }
  return body as T;
}

export type OAuthClient = { clientId: string; clientSecret: string };

export type TokenAnswer = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export function exchangeCode(fetcher: Fetch, client: OAuthClient, code: string, redirectUri: string) {
  return call<TokenAnswer>(
    fetcher,
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
    "exchanging the authorization code",
  );
}

export function refreshAccessToken(fetcher: Fetch, client: OAuthClient, refreshToken: string) {
  return call<TokenAnswer>(
    fetcher,
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
      }),
    },
    "renewing the access token",
  );
}

export function userEmail(fetcher: Fetch, accessToken: string) {
  return call<{ email?: string; email_verified?: boolean }>(
    fetcher,
    USERINFO_URL,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "reading the account's email",
  );
}

export type CalendarListEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
};

export async function listCalendars(fetcher: Fetch, accessToken: string): Promise<CalendarListEntry[]> {
  const entries: CalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${CALENDAR_API}/users/me/calendarList`);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await call<{ items?: CalendarListEntry[]; nextPageToken?: string }>(
      fetcher,
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "listing calendars",
    );
    entries.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return entries;
}

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export async function listEvents(
  fetcher: Fetch,
  accessToken: string,
  calendarId: string,
  from: string,
  to: string,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", from);
    url.searchParams.set("timeMax", to);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await call<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      fetcher,
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "listing events",
    );
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return events;
}
