// The few Google endpoints the product calls, over a `fetch` the caller passes, so tests answer for Google.

export type Fetch = typeof fetch;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
// Several reads of one account travel in one request: a Worker on the free plan makes at most 50 requests of its own
// per request it serves, and a list of messages read one by one would spend one per message.
const GMAIL_BATCH_URL = "https://www.googleapis.com/batch/gmail/v1";

// Reading and writing events, listing which calendars an account has, and reading its mail: nothing broader is asked.
// Gmail is only read: what the person opens here is kept apart, and replying happens in Gmail.
export const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CONNECT_SCOPES = ["openid", "email", EVENTS_SCOPE, CALENDAR_LIST_SCOPE, GMAIL_READ_SCOPE];

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

// What a write sends: a whole day carries dates (the end exclusive, as Google counts it), a timed event instants.
export type GoogleEventInput = {
  summary?: string;
  description?: string | null;
  start?: { date: string } | { dateTime: string };
  end?: { date: string } | { dateTime: string };
};

function eventUrl(calendarId: string, eventId?: string) {
  return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;
}

export function insertEvent(fetcher: Fetch, accessToken: string, calendarId: string, event: GoogleEventInput) {
  return call<GoogleEvent>(
    fetcher,
    eventUrl(calendarId),
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(event) },
    "creating the event",
  );
}

export function patchEvent(fetcher: Fetch, accessToken: string, calendarId: string, eventId: string, event: GoogleEventInput) {
  return call<GoogleEvent>(
    fetcher,
    eventUrl(calendarId, eventId),
    { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(event) },
    "changing the event",
  );
}

export async function deleteEvent(fetcher: Fetch, accessToken: string, calendarId: string, eventId: string): Promise<void> {
  await call<null>(fetcher, eventUrl(calendarId, eventId), { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }, "deleting the event");
}

export type GmailHeader = { name: string; value: string };

// A part of a message as Gmail gives it: the body's bytes come base64url-encoded, already out of their transfer
// encoding, in the part's own charset.
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  // Milliseconds since the epoch, as a string.
  internalDate?: string;
  payload?: GmailPart;
};

export type GmailFormat = "full" | "metadata";

function messageQuery(format: GmailFormat, headers: string[]): string {
  const query = new URLSearchParams({ format });
  if (format === "metadata") for (const name of headers) query.append("metadataHeaders", name);
  return query.toString();
}

// The ids of an account's messages that match a Gmail search, newest first, one page.
export async function listMessageIds(
  fetcher: Fetch,
  accessToken: string,
  search: { q: string; maxResults: number; pageToken?: string },
): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string }> {
  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set("q", search.q);
  url.searchParams.set("maxResults", String(search.maxResults));
  if (search.pageToken) url.searchParams.set("pageToken", search.pageToken);
  const page = await call<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string }>(
    fetcher,
    url.toString(),
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "listing messages",
  );
  return { messages: page.messages ?? [], nextPageToken: page.nextPageToken };
}

export function getMessage(fetcher: Fetch, accessToken: string, id: string, format: GmailFormat, headers: string[] = []) {
  return call<GmailMessage>(
    fetcher,
    `${GMAIL_API}/messages/${encodeURIComponent(id)}?${messageQuery(format, headers)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "reading the message",
  );
}

// At most this many reads in one batch: Gmail takes up to 100 and advises staying under 50 to avoid its rate limit.
export const BATCH_SIZE = 50;

// One answer per id, in the order asked: the message, or the error of that read alone.
export async function getMessages(
  fetcher: Fetch,
  accessToken: string,
  ids: string[],
  format: GmailFormat,
  headers: string[] = [],
): Promise<Array<GmailMessage | GoogleError>> {
  const answers: Array<GmailMessage | GoogleError> = [];
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    answers.push(...(await batchOnce(fetcher, accessToken, ids.slice(start, start + BATCH_SIZE), format, headers)));
  }
  return answers;
}

async function batchOnce(
  fetcher: Fetch,
  accessToken: string,
  ids: string[],
  format: GmailFormat,
  headers: string[],
): Promise<Array<GmailMessage | GoogleError>> {
  if (ids.length === 0) return [];
  const boundary = `batch_${crypto.randomUUID()}`;
  const query = messageQuery(format, headers);
  const body =
    ids
      .map(
        (id, index) =>
          `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <item${index}>\r\n\r\nGET /gmail/v1/users/me/messages/${encodeURIComponent(id)}?${query}\r\n\r\n`,
      )
      .join("") + `--${boundary}--\r\n`;
  let response: Response;
  try {
    response = await fetcher(GMAIL_BATCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/mixed; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GoogleError(`reading the messages: no answer (${error instanceof Error ? error.name : "network"})`, 0, null);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new GoogleError(`reading the messages: HTTP ${response.status}`, response.status, errorReason(text));
  }
  const parts = splitBatch(text, response.headers.get("Content-Type"));
  // Google takes a batch whatever its token and refuses a token in each read: every read refused is the token's failure,
  // thrown as a refused request so its caller renews the token.
  if (ids.every((_, index) => parts.get(`item${index}`)?.status === 401)) {
    throw new GoogleError("reading the messages: HTTP 401", 401, errorReason(parts.get("item0")!.body));
  }
  // Each answer says which read it answers; one that cannot be paired is that read's failure, never another's message.
  return ids.map((_, index) => {
    const part = parts.get(`item${index}`);
    if (!part) return new GoogleError("reading the message: the batch answer left it out", 0, null);
    if (part.status < 200 || part.status >= 300) {
      return new GoogleError(`reading the message: HTTP ${part.status}`, part.status, errorReason(part.body));
    }
    try {
      return JSON.parse(part.body) as GmailMessage;
    } catch {
      return new GoogleError("reading the message: the answer was not JSON", part.status, null);
    }
  });
}

function errorReason(text: string): string | null {
  try {
    const record = JSON.parse(text) as { error?: string | { status?: string } };
    return typeof record.error === "string" ? record.error : (record.error?.status ?? null);
  } catch {
    return null;
  }
}

// The answers of a batch by the id each one names: a `multipart/mixed` body whose parts each hold an HTTP response.
export function splitBatch(text: string, contentType: string | null): Map<string, { status: number; body: string }> {
  const answers = new Map<string, { status: number; body: string }>();
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType ?? "")?.[1];
  if (!boundary) return answers;
  for (const chunk of text.split(`--${boundary}`)) {
    const part = chunk.replace(/^\r?\n/, "");
    if (part.startsWith("--") || part.trim() === "") continue;
    const [partHeaders, ...rest] = part.split(/\r?\n\r?\n/);
    const contentId = /content-id:\s*<?response-([^>\s]+)>?/i.exec(partHeaders)?.[1];
    if (!contentId) continue;
    const httpResponse = rest.join("\r\n\r\n");
    const [head, ...bodyParts] = httpResponse.split(/\r?\n\r?\n/);
    const status = Number(/^HTTP\/[\d.]+\s+(\d{3})/.exec(head.trim())?.[1] ?? 0);
    answers.set(contentId, { status, body: bodyParts.join("\r\n\r\n").trim() });
  }
  return answers;
}
