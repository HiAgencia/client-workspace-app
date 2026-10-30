import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadHistory } from "@/lib/chat/history";
import { MAX_STEPS, systemPrompt } from "@/lib/chat/run";
import { takeUsageFor } from "@/lib/chat/usage";
import { CALENDAR_LIST_SCOPE, EVENTS_SCOPE, GMAIL_READ_SCOPE, type Fetch, type GmailPart } from "@/lib/google/api";
import { decrypt, encrypt, importKey, newKeyBase64 } from "@/lib/google/crypto";
import type { GoogleDeps } from "@/lib/google/events";
import { gmailMailSource } from "@/lib/google/gmail";
import type { MailAccount, MailSource } from "@/lib/mail/source";
import { authenticateAgent } from "@/lib/mcp/auth";
import { currentUser } from "@/lib/supabase/server";
import type { ToolContext } from "@/lib/tools/context";
import type { MailRow } from "@/lib/tools/mail-schema";
import { callTool } from "@/lib/tools/registry";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// The Gmail side is simulated by a fetch that answers like Gmail —its search, a message read alone, and a batch of
// reads— and keeps what each account holds; the database side is the real project. One account reads mail, one was
// connected before mail was asked, and one has its access revoked; under another client, two accounts whose stored
// token Google stopped accepting before its date.

let user: DisposableUser | undefined;
let deps: GoogleDeps;
const ids = { client: "", other: "", mail: "", calendarOnly: "", revoked: "", late: "", gone: "" };
// What reached Google: each call, each search, and the format of each batch.
const calls: string[] = [];
const searches: string[] = [];
const batchFormats: string[] = [];
// How the simulated Gmail misbehaves, set by a test and put back after it.
const trouble = {
  // A read Gmail lists but no longer holds.
  ghost: false,
  // The status the search answers with instead of its result, for every search or only the unread count's.
  search: null as number | null,
  unreadSearch: null as number | null,
  // An unread count with no last page.
  endlessUnread: false,
  // A search that leaves `-in:sent` aside, so what the account sent comes back and only its labels say so.
  leakSent: false,
  // The statuses some reads answer with in a batch, one per read, before answering the message.
  flaky: new Map<string, number[]>(),
};

const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const at = (iso: string) => String(Date.parse(iso));
const headers = (from: string, subject: string) => [
  { name: "From", value: from },
  { name: "To", value: "studio@example.com" },
  { name: "Subject", value: subject },
];

type Stored = { id: string; threadId: string; labelIds: string[]; internalDate: string; snippet: string; payload: GmailPart };

const mailbox: Stored[] = [
  {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
    internalDate: at("2026-10-29T14:58:00Z"),
    snippet: "Your app review was approved",
    payload: {
      mimeType: "multipart/alternative",
      headers: headers("Developer Platform <noreply@developers.example>", "Your app review was approved"),
      parts: [
        { mimeType: "text/plain", body: { data: encode("Your app review was approved.") } },
        { mimeType: "text/html", body: { data: encode("<p>Your app review was <b>approved</b>.</p><script>alert(1)</script>") } },
      ],
    },
  },
  {
    id: "m2",
    threadId: "t2",
    labelIds: ["INBOX"],
    internalDate: at("2026-10-28T10:00:00Z"),
    snippet: "Can we move it to Friday?",
    payload: { mimeType: "text/plain", headers: headers('"Ana Ruiz" <ana@studioatlas.example>', "=?UTF-8?B?Q2Fmw6k=?= meeting"), body: { data: encode("Can we move it to Friday?") } },
  },
  {
    // Archived by a filter: not in the inbox, but it arrived, and a task that waits for it finds it.
    id: "m3",
    threadId: "t3",
    labelIds: ["CATEGORY_UPDATES"],
    internalDate: at("2026-10-29T09:00:00Z"),
    snippet: "Transfer received",
    payload: { mimeType: "text/html", headers: headers("Bank <alerts@bank.example>", "Transfer received"), body: { data: encode("<p>Transfer received</p>") } },
  },
  {
    // Sent by the account: never mail that arrived.
    id: "m4",
    threadId: "t1",
    labelIds: ["SENT"],
    internalDate: at("2026-10-29T15:10:00Z"),
    snippet: "Thanks!",
    payload: { mimeType: "text/plain", headers: headers("studio@example.com", "Re: Your app review was approved"), body: { data: encode("Thanks!") } },
  },
  {
    // A note the account sent itself: in its inbox and unread, yet sent, so neither the list nor the count takes it.
    id: "m5",
    threadId: "t5",
    labelIds: ["INBOX", "UNREAD", "SENT"],
    internalDate: at("2026-10-29T16:00:00Z"),
    snippet: "Remember the invoices",
    payload: { mimeType: "text/plain", headers: headers("studio@example.com", "Remember the invoices"), body: { data: encode("Remember the invoices") } },
  },
];

const fromOf = (message: Stored) => (message.payload.headers ?? []).find((header) => header.name === "From")?.value ?? "";
const subjectOf = (message: Stored) => (message.payload.headers ?? []).find((header) => header.name === "Subject")?.value ?? "";

// A word of a wait: `(from:w OR subject:w …)`, one of its forms in the sender or in the subject.
const WAIT_GROUP = /\(((?:from|subject):[^\s()]+(?: OR (?:from|subject):[^\s()]+)*)\)/g;

// Gmail's search, as far as the source uses it: the inbox, unread, what arrived —never sent, in spam or in the trash—, a
// moment, the words of a wait, and loose words, alone or in one group, in the sender, subject, or snippet.
function search(q: string): Stored[] {
  const after = /after:(\d+)/.exec(q);
  const waits = [...q.matchAll(WAIT_GROUP)].map(([, inner]) =>
    inner.split(" OR ").map((term) => ({ field: term.slice(0, term.indexOf(":")), value: term.slice(term.indexOf(":") + 1).toLowerCase() })),
  );
  const loose = q
    .replace(WAIT_GROUP, " ")
    .replace(/[{}()]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !/^-?(in|is|after):/.test(word))
    .map((word) => word.toLowerCase());
  return mailbox
    .filter((message) => {
      const labels = new Set(message.labelIds);
      if (q.includes("in:inbox") && !labels.has("INBOX")) return false;
      if (q.includes("is:unread") && !labels.has("UNREAD")) return false;
      if (q.includes("-in:sent") && labels.has("SENT") && !trouble.leakSent) return false;
      if (q.includes("-in:spam") && labels.has("SPAM")) return false;
      if (q.includes("-in:trash") && labels.has("TRASH")) return false;
      if (after && Number(message.internalDate) / 1000 <= Number(after[1])) return false;
      const from = fromOf(message).toLowerCase();
      const subject = subjectOf(message).toLowerCase();
      if (!waits.every((forms) => forms.some(({ field, value }) => (field === "from" ? from : subject).includes(value)))) return false;
      const text = `${from} ${subject} ${message.snippet}`.toLowerCase();
      return loose.every((word) => text.includes(word));
    })
    .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
}

// A message as Gmail answers it: metadata keeps only the asked headers and no body.
function answer(id: string, query: URLSearchParams): Stored | null {
  const found = mailbox.find((message) => message.id === id);
  if (!found) return null;
  if (query.get("format") !== "metadata") return found;
  const wanted = new Set(query.getAll("metadataHeaders").map((name) => name.toLowerCase()));
  return { ...found, payload: { mimeType: found.payload.mimeType, headers: (found.payload.headers ?? []).filter((header) => wanted.has(header.name.toLowerCase())) } };
}

const READERS = new Set(["token-mail", "token-late"]);

const fakeGoogle: Fetch = async (input, init) => {
  const url = new URL(String(input));
  calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  if (url.pathname === "/token") {
    const refresh = new URLSearchParams(String(init?.body)).get("refresh_token");
    if (refresh === "refresh-revoked") return json(400, { error: "invalid_grant" });
    return json(200, { access_token: `token-${refresh?.replace("refresh-", "")}`, expires_in: 3600 });
  }
  const token = (init?.headers as Record<string, string>).Authorization.replace("Bearer ", "");
  // A token Google stopped accepting before its date: a request answers 401, while a batch is taken and each of its reads
  // answers 401, as Gmail answers a refused token.
  const dead = token === "token-dead";
  if (dead && url.pathname !== "/batch/gmail/v1") return json(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
  if (!dead && !READERS.has(token)) return json(403, { error: { status: "PERMISSION_DENIED" } });
  if (url.pathname === "/gmail/v1/users/me/messages") {
    const q = url.searchParams.get("q") ?? "";
    searches.push(q);
    const failing = q.includes("is:unread") ? (trouble.unreadSearch ?? trouble.search) : trouble.search;
    if (failing) return json(failing, { error: { code: failing, status: failing === 429 ? "RESOURCE_EXHAUSTED" : failing === 403 ? "PERMISSION_DENIED" : "INTERNAL" } });
    const page = Number(url.searchParams.get("pageToken") ?? 0);
    const size = Number(url.searchParams.get("maxResults") ?? 100);
    if (trouble.endlessUnread && q.includes("is:unread")) {
      const listed = page === 0 ? search(q).map(({ id, threadId }) => ({ id, threadId })) : [{ id: `older-${page}`, threadId: `older-${page}` }];
      return json(200, { messages: listed, nextPageToken: String(page + 1) });
    }
    const found = search(q);
    const listed = found.slice(page * size, (page + 1) * size).map(({ id, threadId }) => ({ id, threadId }));
    if (trouble.ghost) listed.push({ id: "ghost", threadId: "tg" });
    return json(200, { messages: listed, ...(found.length > (page + 1) * size ? { nextPageToken: String(page + 1) } : {}) });
  }
  if (url.pathname.startsWith("/gmail/v1/users/me/messages/")) {
    const message = answer(decodeURIComponent(url.pathname.split("/").pop()!), url.searchParams);
    return message ? json(200, message) : json(404, { error: { code: 404, status: "NOT_FOUND" } });
  }
  if (url.pathname === "/batch/gmail/v1") {
    const body = String(init?.body);
    const parts = [...body.matchAll(/Content-ID: <(item\d+)>\r\n\r\nGET \/gmail\/v1\/users\/me\/messages\/([^?\s]+)\?(\S+)/g)];
    batchFormats.push(new URLSearchParams(parts[0]?.[3] ?? "").get("format") ?? "");
    const answers = parts.map(([, item, id, query]) => {
      const planned = dead ? 401 : trouble.flaky.get(decodeURIComponent(id))?.shift();
      const message = planned ? null : answer(decodeURIComponent(id), new URLSearchParams(query));
      const status = planned ? `${planned} Trouble` : message ? "200 OK" : "404 Not Found";
      const payload = message ? JSON.stringify(message) : JSON.stringify({ error: { code: planned ?? 404, ...(dead ? { status: "UNAUTHENTICATED" } : {}) } });
      return `--batch_fake\r\nContent-Type: application/http\r\nContent-ID: <response-${item}>\r\n\r\nHTTP/1.1 ${status}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${payload}\r\n`;
    });
    return new Response(`${answers.join("")}--batch_fake--\r\n`, { status: 200, headers: { "Content-Type": "multipart/mixed; boundary=batch_fake" } });
  }
  return json(404, { error: "not_found" });
};

function clearTrouble() {
  Object.assign(trouble, { ghost: false, search: null, unreadSearch: null, endlessUnread: false, leakSent: false });
  trouble.flaky.clear();
}

function forget() {
  calls.length = 0;
  searches.length = 0;
  batchFormats.length = 0;
}

async function insertAccount(
  email: string,
  refresh: string,
  scopes: string[],
  options: { node?: string; status?: "active" | "revoked"; access?: { token: string; until: string }; owner?: DisposableUser } = {},
) {
  const service = serviceClient();
  const { data, error } = await service
    .from("google_accounts")
    .insert({
      owner_id: (options.owner ?? user!).id,
      email,
      refresh_token: await encrypt(deps.key, refresh),
      // By default an expired access token, which forces the renewal path.
      access_token: await encrypt(deps.key, options.access?.token ?? "stale"),
      access_token_expires_at: options.access?.until ?? "2020-01-01T00:00:00Z",
      scopes,
      status: options.status ?? "active",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const attached = await service.from("node_accounts").insert({ node_id: options.node ?? ids.client, account_id: data.id });
  if (attached.error) throw new Error(attached.error.message);
  return data.id;
}

const account = (id: string, email: string, scopes: string[], status = "active"): MailAccount => ({ id, email, isDemo: false, status, scopes });
const ALL = ["openid", "email", EVENTS_SCOPE, CALENDAR_LIST_SCOPE, GMAIL_READ_SCOPE];
const CALENDAR_ONLY = ["openid", "email", EVENTS_SCOPE, CALENDAR_LIST_SCOPE];
const mailAccount = () => account(ids.mail, "studio@example.com", ALL);
const context = (): ToolContext => ({ db: user!.client, ownerId: user!.id, source: "manual", mail: gmailMailSource(deps) });

beforeAll(async () => {
  user = await createDisposableUser("gmail");
  deps = { service: serviceClient(), key: await importKey(newKeyBase64()), client: { clientId: "id", clientSecret: "secret" }, fetch: fakeGoogle };
  const node = await user.client.from("nodes").insert({ owner_id: user.id, kind: "client", name: "Acme" }).select("id").single();
  if (node.error) throw new Error(node.error.message);
  ids.client = node.data.id;
  const other = await user.client.from("nodes").insert({ owner_id: user.id, kind: "client", name: "Beta" }).select("id").single();
  if (other.error) throw new Error(other.error.message);
  ids.other = other.data.id;
  ids.mail = await insertAccount("studio@example.com", "refresh-mail", ALL);
  ids.calendarOnly = await insertAccount("calendar@example.com", "refresh-calendar", CALENDAR_ONLY);
  ids.revoked = await insertAccount("gone@example.com", "refresh-revoked", ALL);
  // Valid by its date, yet Google refuses it: one renews, the other's grant was revoked from the Google account.
  ids.late = await insertAccount("late@example.com", "refresh-late", ALL, { node: ids.other, access: { token: "token-dead", until: "2099-01-01T00:00:00Z" } });
  ids.gone = await insertAccount("revoked-late@example.com", "refresh-revoked", ALL, { node: ids.other, access: { token: "token-dead", until: "2099-01-01T00:00:00Z" } });
}, 60_000);

afterAll(async () => {
  if (user) await deleteDisposableUsers([user]);
}, 60_000);

describe("the Gmail source", () => {
  const accounts = () => [mailAccount(), account(ids.calendarOnly, "calendar@example.com", CALENDAR_ONLY), account(ids.revoked, "gone@example.com", ALL)];

  it("lists what arrived in the inbox, newest first, in one batch per account, and says why an account is not read", async () => {
    forget();
    const { messages, failures } = await gmailMailSource(deps).list({ db: user!.client, ownerId: user!.id, accounts: accounts(), limit: 10 });
    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(messages[0]).toMatchObject({
      accountId: ids.mail,
      accountEmail: "studio@example.com",
      from: { name: "Developer Platform", email: "noreply@developers.example" },
      to: ["studio@example.com"],
      subject: "Your app review was approved",
      unread: true,
      important: true,
      receivedAt: "2026-10-29T14:58:00.000Z",
    });
    expect(messages[1]).toMatchObject({ subject: "Café meeting", unread: false, important: false });
    // A list carries no body.
    expect(messages[0]).not.toHaveProperty("html");
    expect(failures).toEqual(
      expect.arrayContaining([
        { accountId: ids.calendarOnly, accountEmail: "calendar@example.com", reason: expect.stringMatching(/reading mail was not granted/) },
        { accountId: ids.revoked, accountEmail: "gone@example.com", reason: expect.stringMatching(/access was revoked/) },
      ]),
    );
    expect(failures).toHaveLength(2);
    // The account connected without mail is never asked; the readable one costs one search and one batch of metadata.
    expect(calls.filter((call) => call.includes("/batch/gmail/v1"))).toHaveLength(1);
    expect(calls.filter((call) => call.endsWith("/gmail/v1/users/me/messages"))).toHaveLength(1);
    expect(batchFormats).toEqual(["metadata"]);
  });

  it("leaves out what the account sent even when the search brings it, and counts the unread the list shows", async () => {
    trouble.leakSent = true;
    try {
      const { messages } = await gmailMailSource(deps).list({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()], limit: 10 });
      expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    } finally {
      clearTrouble();
    }
    // The note the account sent itself is unread in its inbox, and is not counted, as the list does not show it.
    const { messages, failures } = await gmailMailSource(deps).unread({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()] });
    expect(failures).toEqual([]);
    expect(messages).toEqual([{ accountId: ids.mail, id: "m1" }]);
  });

  it("looks for a wait's possible replies in what arrived since it began, archived included, and never in what the account sent", async () => {
    const since = "2026-10-29T00:00:00Z";
    const candidates = (words: string[]) => gmailMailSource(deps).candidates({ db: user!.client, ownerId: user!.id, account: mailAccount(), since, words, limit: 10 });
    forget();
    const archived = await candidates(["Transfer"]);
    expect(archived).toEqual({ messages: [expect.objectContaining({ id: "m3", subject: "Transfer received" })], failures: [], nextPageToken: null });
    expect(searches).toEqual([`-in:sent -in:draft -in:chats -in:spam -in:trash (from:transfer OR subject:transfer) after:${Date.parse(since) / 1000}`]);
    expect(batchFormats).toEqual(["metadata"]);
    // What the account sent is left out by its labels too, when a search brings it.
    trouble.leakSent = true;
    try {
      expect((await candidates(["approved"])).messages.map((message) => message.id)).toEqual(["m1"]);
    } finally {
      clearTrouble();
    }
  });

  it("reads one message whole, and answers nothing for one the account does not hold", async () => {
    const source = gmailMailSource(deps);
    const found = await source.get({ db: user!.client, ownerId: user!.id, account: mailAccount(), id: "m2" });
    expect(found).toMatchObject({ id: "m2", subject: "Café meeting", text: "Can we move it to Friday?", html: null });
    expect(await source.get({ db: user!.client, ownerId: user!.id, account: mailAccount(), id: "missing" })).toBeNull();
    await expect(source.get({ db: user!.client, ownerId: user!.id, account: account(ids.calendarOnly, "calendar@example.com", CALENDAR_ONLY), id: "m1" })).rejects.toThrow(
      /reading mail was not granted/,
    );
  });

  it("takes a message deleted between the search and the read for gone, not for a failure", async () => {
    trouble.ghost = true;
    try {
      const { messages, failures } = await gmailMailSource(deps).list({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()], limit: 10 });
      expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
      expect(failures).toEqual([]);
    } finally {
      clearTrouble();
    }
  });

  it("asks once more for a read Gmail answered with its rate limit, and counts one that keeps failing", async () => {
    forget();
    trouble.flaky.set("m2", [429]);
    try {
      const { messages, failures } = await gmailMailSource(deps).list({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()], limit: 10 });
      expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
      expect(failures).toEqual([]);
      // The second ask is one batch with the read that failed.
      expect(calls.filter((call) => call.includes("/batch/gmail/v1"))).toHaveLength(2);
    } finally {
      clearTrouble();
    }
    trouble.flaky.set("m2", [500, 500]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { messages, failures } = await gmailMailSource(deps).list({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()], limit: 10 });
      expect(messages.map((message) => message.id)).toEqual(["m1"]);
      expect(failures).toEqual([{ accountId: ids.mail, accountEmail: "studio@example.com", reason: "1 of 2 messages could not be read" }]);
      // The log says each status, by the account's id and never its address.
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain(`account ${ids.mail}`);
      expect(logged).toContain("500 × 1");
      expect(logged).not.toContain("studio@example.com");
      // One message alone is said in the singular.
      trouble.flaky.set("m2", [500, 500]);
      const alone = await gmailMailSource(deps).many({ db: user!.client, ownerId: user!.id, account: mailAccount(), ids: ["m2"] });
      expect(alone.failures).toEqual([{ accountId: ids.mail, accountEmail: "studio@example.com", reason: "1 of 1 message could not be read" }]);
    } finally {
      spy.mockRestore();
      clearTrouble();
    }
  });

  it.each([403, 429, 500])("says an account whose search Gmail answers %i failed, by its id in the log, and reads the others", async (status) => {
    trouble.search = status;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { messages, failures } = await gmailMailSource(deps).list({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()], limit: 10 });
      expect(messages).toEqual([]);
      expect(failures).toEqual([{ accountId: ids.mail, accountEmail: "studio@example.com", reason: expect.stringContaining(`HTTP ${status}`) }]);
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain(`account ${ids.mail}`);
      expect(logged).not.toContain("studio@example.com");
    } finally {
      spy.mockRestore();
      clearTrouble();
    }
  });

  it("renews once a token Google refused before its date, and marks an account whose grant was revoked", async () => {
    forget();
    const { messages, failures } = await gmailMailSource(deps).list({
      db: user!.client,
      ownerId: user!.id,
      accounts: [account(ids.late, "late@example.com", ALL), account(ids.gone, "revoked-late@example.com", ALL)],
      limit: 10,
    });
    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(failures).toEqual([{ accountId: ids.gone, accountEmail: "revoked-late@example.com", reason: expect.stringMatching(/access was revoked: connect the account again/) }]);
    expect(calls.filter((call) => call.endsWith("/token"))).toHaveLength(2);
    const { data } = await serviceClient().from("google_accounts").select("id, access_token, status").in("id", [ids.late, ids.gone]);
    const late = data!.find((row) => row.id === ids.late)!;
    expect(await decrypt(deps.key, late.access_token!)).toBe("token-late");
    expect(late.status).toBe("active");
    expect(data!.find((row) => row.id === ids.gone)!.status).toBe("revoked");
  });

  it("renews once a token Google refused in each read of a batch, which the mail of a task reaches with no search first", async () => {
    const dead = { node: ids.other, access: { token: "token-dead", until: "2099-01-01T00:00:00Z" } };
    const late = await insertAccount("late-batch@example.com", "refresh-late", ALL, dead);
    const gone = await insertAccount("revoked-batch@example.com", "refresh-revoked", ALL, dead);
    forget();
    const source = gmailMailSource(deps);
    const read = await source.many({ db: user!.client, ownerId: user!.id, account: account(late, "late-batch@example.com", ALL), ids: ["m1", "m2"] });
    expect(read.failures).toEqual([]);
    expect(read.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    const refused = await source.many({ db: user!.client, ownerId: user!.id, account: account(gone, "revoked-batch@example.com", ALL), ids: ["m1"] });
    expect(refused).toEqual({ messages: [], failures: [{ accountId: gone, accountEmail: "revoked-batch@example.com", reason: expect.stringMatching(/access was revoked: connect the account again/) }] });
    expect(calls.filter((call) => call.endsWith("/token"))).toHaveLength(2);
    const { data } = await serviceClient().from("google_accounts").select("id, status").in("id", [late, gone]);
    expect(data!.find((row) => row.id === late)!.status).toBe("active");
    expect(data!.find((row) => row.id === gone)!.status).toBe("revoked");
  });

  it("reads nothing of an account of another person", async () => {
    const other = await createDisposableUser("gmail-other");
    try {
      const source = gmailMailSource(deps);
      const theirs = account(ids.mail, "studio@example.com", ALL);
      await expect(source.get({ db: other.client, ownerId: other.id, account: theirs, id: "m1" })).rejects.toThrow(/the account was not found/);
      const listed = await source.list({ db: other.client, ownerId: other.id, accounts: [theirs], limit: 10 });
      expect(listed).toEqual({ messages: [], failures: [{ accountId: ids.mail, accountEmail: "studio@example.com", reason: "the account was not found" }] });
      const some = await source.many({ db: other.client, ownerId: other.id, account: theirs, ids: ["m1"] });
      expect(some.messages).toEqual([]);
    } finally {
      await deleteDisposableUsers([other]);
    }
  });
});

describe("the tools over Gmail", () => {
  type Listed = {
    ok: boolean;
    unread: number;
    unreadByAccount: Record<string, number>;
    groups: { unread: { messages: Array<{ id: string }> }; earlier: { messages: Array<{ id: string }> } };
    failures: Array<{ accountId: string; accountEmail: string; reason: string }>;
  };

  it("reaches the tools: the Mail list groups the account's messages and get_mail sanitizes what it shows", async () => {
    const listed = (await callTool("list_mail", context(), { node: ids.client })) as unknown as Listed;
    expect(listed.ok).toBe(true);
    expect(listed.unread).toBe(1);
    expect(listed.groups.unread.messages.map((message) => message.id)).toEqual(["m1"]);
    expect(listed.groups.earlier.messages.map((message) => message.id)).toEqual(["m2"]);
    // One failure per account, though its list and its count both failed.
    expect(listed.failures.map((failure) => failure.accountEmail).sort()).toEqual(["calendar@example.com", "gone@example.com"]);
    const opened = (await callTool("get_mail", context(), { account: ids.mail, id: "m1" })) as unknown as { ok: boolean; message: { html: string; text: string | null } };
    expect(opened.ok).toBe(true);
    expect(opened.message.html).toContain("approved");
    expect(opened.message.html).not.toContain("<script");
    expect(opened.message.text).toBe("Your app review was approved.");
  });

  it("says an unread count that stopped short, and keeps an account whose count failed out of the figures", async () => {
    trouble.endlessUnread = true;
    try {
      const listed = (await callTool("list_mail", context(), { node: ids.client })) as unknown as Listed;
      expect(listed.failures).toEqual(expect.arrayContaining([{ accountId: ids.mail, accountEmail: "studio@example.com", reason: expect.stringMatching(/^only the latest \d+ unread messages were counted$/) }]));
      // What it counted before stopping stays, said as a part.
      expect(listed.unreadByAccount[ids.mail]).toBeGreaterThan(0);
    } finally {
      clearTrouble();
    }
    trouble.unreadSearch = 500;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const listed = (await callTool("list_mail", context(), { node: ids.client })) as unknown as Listed;
      // The list still reads; the count's failure is said, and the account is no zero.
      expect(listed.groups.unread.messages.map((message) => message.id)).toEqual(["m1"]);
      expect(listed.failures).toEqual(expect.arrayContaining([{ accountId: ids.mail, accountEmail: "studio@example.com", reason: expect.stringContaining("HTTP 500") }]));
      expect(listed.unreadByAccount).not.toHaveProperty(ids.mail);
      expect(listed.unread).toBe(0);
      const tree = (await callTool("list_tree", context(), { withMail: true })) as unknown as { mail: { unread: number; failures: Array<{ accountId: string }> } };
      expect(tree.mail.failures.map((failure) => failure.accountId)).toContain(ids.mail);
    } finally {
      spy.mockRestore();
      clearTrouble();
    }
  });

  it("searches with Gmail's own search, in one search and one batch of metadata per account", async () => {
    forget();
    const found = (await callTool("search_items", context(), { query: "approved", node: ids.client })) as unknown as {
      ok: boolean;
      mail: Array<{ id: string }>;
      mailFailures: Array<{ accountEmail: string }>;
    };
    expect(found.ok).toBe(true);
    expect(found.mail.map((row) => row.id)).toEqual(["m1"]);
    expect(found.mailFailures.map((failure) => failure.accountEmail).sort()).toEqual(["calendar@example.com", "gone@example.com"]);
    expect(searches).toEqual(["in:inbox -in:sent -in:draft -in:chats (approved)"]);
    expect(calls.filter((call) => call.includes("/batch/gmail/v1"))).toHaveLength(1);
    expect(batchFormats).toEqual(["metadata"]);
    // The words stay one group of the inbox's search: what would close it or open another reaches Gmail as a space.
    forget();
    await callTool("search_items", context(), { query: "approved) OR {in:anywhere", node: ids.client });
    expect(searches).toEqual(["in:inbox -in:sent -in:draft -in:chats (approved OR in:anywhere)"]);
  });

  it("reads the mail of a task in one batch of metadata per account", async () => {
    const { data: task, error } = await user!.client.from("items").insert({ owner_id: user!.id, node_id: ids.client, type: "task", title: "Answer the studio" }).select("id").single();
    if (error) throw new Error(error.message);
    const linked = await user!.client.from("mail_links").insert(["m1", "m2", "m3"].map((message) => ({ owner_id: user!.id, account_id: ids.mail, message_id: message, item_id: task.id })));
    if (linked.error) throw new Error(linked.error.message);
    forget();
    const detail = (await callTool("get_item", context(), { id: task.id })) as unknown as { ok: boolean; messages: Array<{ id: string }>; mailFailures: unknown[] };
    expect(detail.ok).toBe(true);
    expect(detail.messages.map((row) => row.id)).toEqual(["m1", "m3", "m2"]);
    expect(detail.mailFailures).toEqual([]);
    expect(calls.filter((call) => call.includes("/batch/gmail/v1"))).toHaveLength(1);
    expect(calls.filter((call) => /\/gmail\/v1\/users\/me\/messages\/./.test(call))).toHaveLength(0);
    expect(batchFormats).toEqual(["metadata"]);
  });
});

describe("what a task waits for, over a busy inbox", () => {
  // Each task here waits for «Bayside Bank» in the account that reads mail, as the person sets it. The bank wrote once
  // before any of these waits began; after, it writes twice —the transfer, and new card terms—, a newsletter sends more
  // mail than one read brings, and a third message from the bank lands in spam. They sit an hour from now each way, so
  // every task the tests start waits between them. Each control reads the piece it is handed; its twin, a broken version
  // of that piece, fails it with the control's own words.
  const HOUR = 3_600_000;
  type Replies = { ok: boolean; replies: MailRow[]; more: string[]; failures: unknown[] };
  type Reply = { account: string; id: string };
  const planted: Stored[] = [];
  let start = 0;

  const message = (id: string, from: string, subject: string, offset: number, labelIds: string[]): Stored => ({
    id,
    threadId: id,
    labelIds,
    internalDate: String(start + offset),
    snippet: subject,
    payload: { mimeType: "text/plain", headers: headers(from, subject), body: { data: encode(subject) } },
  });

  beforeAll(() => {
    start = Date.now();
    const bank = "Bayside Bank <alerts@bayside.example>";
    planted.push(
      message("bank-before", bank, "Your monthly statement", -HOUR, ["INBOX"]),
      message("bank-transfer", bank, "Transfer received", HOUR, ["INBOX", "UNREAD"]),
      message("bank-card", bank, "New card terms", HOUR + 60_000, ["INBOX"]),
      message("bank-spam", bank, "You won a prize", HOUR + 120_000, ["SPAM"]),
    );
    for (let index = 0; index < 60; index++) planted.push(message(`news-${index}`, "Newsletter <news@example.com>", `Issue ${index}`, HOUR + 1000 * (index + 1), ["INBOX"]));
    mailbox.push(...planted);
  });

  afterAll(() => {
    for (const each of planted) mailbox.splice(mailbox.indexOf(each), 1);
  });

  // A task of the client that waits for the bank in the account that reads mail.
  async function waitingTask(): Promise<string> {
    const created = (await callTool("create_task", context(), { node: ids.client, title: "Wait for the transfer" })) as unknown as { ok: boolean; item: { id: string } };
    expect(created.ok).toBe(true);
    const waits = await callTool("set_task_mail", context(), { task: created.item.id, account: ids.mail, words: "Bayside Bank" });
    expect(waits.ok).toBe(true);
    return created.item.id;
  }
  const replies = (task: string, ctx = context()) => callTool("list_task_replies", ctx, { task, account: ids.mail }) as unknown as Promise<Replies>;
  const idsOf = (read: Replies) => read.replies.map((reply) => reply.id);

  async function failsWith(control: () => Promise<void>, phrase: string) {
    let failure: unknown = null;
    try {
      await control();
    } catch (error) {
      failure = error;
    }
    expect(String((failure as Error | null)?.message), `the twin fails «${phrase}»`).toContain(phrase);
  }

  // ---- The possible replies: every message of the sender since the wait began, and reading them decides nothing ----
  type List = (task: string) => Promise<Replies>;

  async function everyReplyOfTheSender(list: List) {
    const read = await list(await waitingTask());
    expect(idsOf(read), "every message of the bank since the wait began is a possible reply").toEqual(["bank-card", "bank-transfer"]);
  }

  async function readingDecidesNothing(list: List) {
    const task = await waitingTask();
    expect((await list(task)).replies.length).toBeGreaterThan(0);
    const [item, under, links] = await Promise.all([
      user!.client.from("items").select("status").eq("id", task).single(),
      user!.client.from("items").select("id").eq("parent_item_id", task),
      user!.client.from("mail_links").select("id").eq("item_id", task),
    ]);
    expect({ status: item.data?.status, under: under.data?.length, links: links.data?.length }, "reading the possible replies decides nothing: the task stays open").toEqual({
      status: "open",
      under: 0,
      links: 0,
    });
  }

  it("shows every message of the sender since the wait began as a possible reply, under a busy inbox, and decides nothing", async () => {
    forget();
    await everyReplyOfTheSender(replies);
    // One search of the bank's words, which no newsletter holds, and never spam.
    expect(searches.filter((q) => q.includes("(from:bayside OR subject:bayside) (from:bank OR subject:bank)") && q.includes("-in:spam"))).toHaveLength(1);
    await readingDecidesNothing(replies);
  });

  it("its twins: a read that keeps one reply, or that closes the task once a reply arrives, fails its control", async () => {
    const newestOnly: List = async (task) => {
      const read = await replies(task);
      return { ...read, replies: read.replies.slice(0, 1) };
    };
    await failsWith(() => everyReplyOfTheSender(newestOnly), "every message of the bank since the wait began is a possible reply");
    const closesOnReply: List = async (task) => {
      const read = await replies(task);
      if (read.replies.length > 0) await callTool("update_item", context(), { id: task, status: "done" });
      return read;
    };
    await failsWith(() => readingDecidesNothing(closesOnReply), "reading the possible replies decides nothing");
  });

  // ---- What arrived before the wait began ----
  async function onlySinceTheWait(source: MailSource) {
    const read = await replies(await waitingTask(), { ...context(), mail: source });
    expect(read.ok).toBe(true);
    expect(idsOf(read), "what arrived before the wait began is no possible reply").not.toContain("bank-before");
  }

  it("leaves out what arrived before the wait began", async () => {
    await onlySinceTheWait(gmailMailSource(deps));
  });

  it("its twin: a source that reads from before the wait fails it", async () => {
    const real = gmailMailSource(deps);
    const fromAlways: MailSource = { ...real, candidates: (args) => real.candidates({ ...args, since: "2000-01-01T00:00:00Z" }) };
    await failsWith(() => onlySinceTheWait(fromAlways), "what arrived before the wait began is no possible reply");
  });

  // ---- Page after page: however many replies arrived, every one is reached ----
  type Page = (task: string, pageToken?: string) => Promise<Replies & { next: Record<string, string> }>;
  const page: Page = (task, pageToken) =>
    callTool("list_task_replies", context(), { task, account: ids.mail, limit: 1, ...(pageToken ? { pageToken } : {}) }) as unknown as ReturnType<Page>;

  async function everyPageOnce(reader: Page) {
    const task = await waitingTask();
    const read: string[] = [];
    let token: string | undefined;
    // A reader that never ends would loop for ever: a few more pages than there are replies is enough to see it.
    for (let pages = 0; pages < 4; pages++) {
      const answer = await reader(task, token);
      read.push(...idsOf(answer));
      token = answer.next[ids.mail];
      if (!token) break;
    }
    expect(read, "page after page brings every possible reply, each once").toEqual(["bank-card", "bank-transfer"]);
  }

  it("reads the possible replies page after page, one account at a time", async () => {
    await everyPageOnce(page);
    const task = await waitingTask();
    expect(await callTool("list_task_replies", context(), { task, pageToken: "1" })).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("its twin: a reader that ignores where the next page starts fails it", async () => {
    await failsWith(() => everyPageOnce((task) => page(task)), "page after page brings every possible reply, each once");
  });

  // ---- Ruling a reply out, taking it back, and other words ----
  type Rule = (task: string, id: string, dismissed: boolean) => Promise<unknown>;
  const rule: Rule = (task, id, dismissed) => callTool("dismiss_reply", context(), { task, account: ids.mail, id, dismissed });

  async function ruledOutAndBack(ruling: Rule) {
    const task = await waitingTask();
    await ruling(task, "bank-card", true);
    expect(idsOf(await replies(task)), "a reply ruled out leaves the possible ones").toEqual(["bank-transfer"]);
    await ruling(task, "bank-card", false);
    expect(idsOf(await replies(task)), "taking the ruling back returns it").toEqual(["bank-card", "bank-transfer"]);
  }

  type Reword = (task: string, words: string) => Promise<unknown>;
  const reword: Reword = (task, words) => callTool("set_task_mail", context(), { task, words });

  async function otherWordsStartOver(rewording: Reword) {
    const task = await waitingTask();
    await rule(task, "bank-card", true);
    await rewording(task, "Bayside");
    expect(idsOf(await replies(task)), "other words are another wait: what was ruled out for the old ones shows again").toEqual(["bank-card", "bank-transfer"]);
  }

  it("rules a reply out and takes the ruling back, and other words start the wait over", async () => {
    await ruledOutAndBack(rule);
    await otherWordsStartOver(reword);
  });

  it("its twins: a ruling or a taking back that writes nothing, and other words that keep the old rulings, fail their step", async () => {
    await failsWith(() => ruledOutAndBack(async () => ({ ok: true })), "a reply ruled out leaves the possible ones");
    await failsWith(() => ruledOutAndBack((task, id, dismissed) => (dismissed ? rule(task, id, true) : Promise.resolve({ ok: true }))), "taking the ruling back returns it");
    const keepsRulings: Reword = async (task, words) => {
      const before = await user!.client.from("task_mail").select("dismissed").eq("item_id", task).single();
      await reword(task, words);
      await user!.client.from("task_mail").update({ dismissed: before.data!.dismissed }).eq("item_id", task);
    };
    await failsWith(() => otherWordsStartOver(keepsRulings), "other words are another wait");
  });

  // ---- A wait let go or reworded, and put back as it was ----
  type Wait = { accountId: string | null; waitsFor: string; since: string; dismissed: string[] };
  type Read = Replies & { task: { since: string } };
  type PutBack = (task: string, previous: Wait) => Promise<unknown>;
  const putBack: PutBack = (task, previous) =>
    callTool("set_task_mail", context(), { task, account: previous.accountId, words: previous.waitsFor, since: previous.since, dismissed: previous.dismissed });

  // The change a wait goes through before it is put back: let go, or other words.
  const LET_GO = { waiting: false };
  const REWORDED = { words: "Bayside" };

  async function putBackAsItWas(change: typeof LET_GO | typeof REWORDED, putting: PutBack) {
    const task = await waitingTask();
    await rule(task, "bank-card", true);
    const before = (await replies(task)) as Read;
    const changed = (await callTool("set_task_mail", context(), { task, ...change })) as unknown as { ok: boolean; previous: Wait };
    expect(changed.ok).toBe(true);
    await putting(task, changed.previous);
    const after = (await replies(task)) as Read;
    expect({ since: after.task.since, replies: idsOf(after) }, "a wait put back begins when it began and keeps what it had ruled out").toEqual({
      since: before.task.since,
      replies: idsOf(before),
    });
  }

  // The undo as it was before: the account and the words, without the moment it began or what it had ruled out.
  const wordsOnly: PutBack = (task, previous) => callTool("set_task_mail", context(), { task, account: previous.accountId, words: previous.waitsFor });

  it("puts back a wait let go as it was: since when it waited and what it had ruled out", async () => {
    await putBackAsItWas(LET_GO, putBack);
  });

  it("its twin: a wait let go and put back with only its account and words fails it", async () => {
    await failsWith(() => putBackAsItWas(LET_GO, wordsOnly), "a wait put back begins when it began");
  });

  it("puts back a reworded wait as it was: what it had ruled out stays ruled out", async () => {
    await putBackAsItWas(REWORDED, putBack);
  });

  it("its twin: a reworded wait put back with only its account and words fails it", async () => {
    await failsWith(() => putBackAsItWas(REWORDED, wordsOnly), "a wait put back begins when it began");
  });

  it("refuses to put back a wait that would begin before its task existed", async () => {
    const task = await waitingTask();
    expect((await callTool("set_task_mail", context(), { task, waiting: false })).ok).toBe(true);
    expect(await callTool("set_task_mail", context(), { task, words: "Bayside Bank", since: "2000-01-01T00:00:00+00:00" })).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: expect.stringContaining("before its task existed"),
    });
  });

  // ---- Two first waits at once ----
  // Holds each insert into `task_mail` until `parties` of them arrived, so two first waits race for real: both read that
  // the task waits for nothing, and both insert.
  function racingInserts(db: ToolContext["db"], parties: number): ToolContext["db"] {
    let arrived = 0;
    let release!: () => void;
    const together = new Promise<void>((resolve) => (release = resolve));
    const held = <T extends object>(builder: T): T =>
      new Proxy(builder, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
              if (++arrived === parties) release();
              return together.then(() => (value as PromiseLike<unknown>["then"]).call(target, resolve, reject));
            };
          }
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            const out = (value as (...rest: unknown[]) => unknown).apply(target, args);
            return out !== null && typeof out === "object" ? held(out) : out;
          };
        },
      });
    return new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (prop !== "from") return typeof value === "function" ? (value as (...rest: unknown[]) => unknown).bind(target) : value;
        return (table: string) => {
          const builder = (value as (name: string) => object).call(target, table);
          if (table !== "task_mail") return builder;
          return new Proxy(builder, {
            get(inner, key) {
              const member = Reflect.get(inner, key, inner) as unknown;
              if (key === "insert") return (...args: unknown[]) => held((member as (...rest: unknown[]) => object).apply(inner, args));
              return typeof member === "function" ? (member as (...rest: unknown[]) => unknown).bind(inner) : member;
            },
          });
        };
      },
    });
  }

  async function newTask(): Promise<string> {
    const created = (await callTool("create_task", context(), { node: ids.client, title: "Wait for the bank" })) as unknown as { ok: boolean; item: { id: string } };
    expect(created.ok).toBe(true);
    return created.item.id;
  }

  it("takes two first waits at once: the one that finds the row taken writes over it", async () => {
    const task = await newTask();
    const racing = { ...context(), db: racingInserts(user!.client, 2) };
    const answers = await Promise.all(["Bayside", "Bayside Bank"].map((words) => callTool("set_task_mail", racing, { task, account: ids.mail, words })));
    expect(
      answers.map((answer) => answer.ok),
      "two first waits at once both hold",
    ).toEqual([true, true]);
  });

  it("its control: two plain inserts held together race, and one of them finds the row taken", async () => {
    const task = await newTask();
    const db = racingInserts(user!.client, 2);
    const row = { item_id: task, owner_id: user!.id, account_id: ids.mail, waits_for: "Bayside" };
    const answers = await Promise.all([1, 2].map(() => db.from("task_mail").insert(row).select("item_id").single()));
    expect(
      answers.filter((answer) => answer.error?.code === "23505"),
      "held together, the second insert finds the row the first one wrote",
    ).toHaveLength(1);
  });

  // ---- An account its place stopped seeing ----
  it("reads a wait whose account was taken off its client for nobody, and says why instead of finding nothing", async () => {
    const node = await user!.client.from("nodes").insert({ owner_id: user!.id, kind: "client", name: "Gamma" }).select("id").single();
    expect(node.error).toBeNull();
    const attached = await user!.client.from("node_accounts").insert({ node_id: node.data!.id, account_id: ids.mail });
    expect(attached.error).toBeNull();
    const created = (await callTool("create_task", context(), { node: node.data!.id, title: "Wait for the transfer" })) as unknown as { ok: boolean; item: { id: string } };
    expect((await callTool("set_task_mail", context(), { task: created.item.id, account: ids.mail, words: "Bayside Bank" })).ok).toBe(true);
    const detached = await user!.client.from("node_accounts").delete().eq("node_id", node.data!.id).eq("account_id", ids.mail);
    expect(detached.error).toBeNull();
    expect(await callTool("list_task_replies", context(), { task: created.item.id }), "an account its place no longer sees is read for nobody, and the answer says why").toMatchObject({
      ok: false,
      code: "not_found",
      message: expect.stringContaining("not connected where the task lives anymore"),
    });
  });

  // ---- Closing a task with its result ----
  type Close = (task: string, outcome: string, reply: Reply) => Promise<unknown>;
  const close: Close = (task, outcome, reply) => callTool("complete_task", context(), { task, outcome, reply });

  async function closedWithItsResult(closing: Close) {
    const task = await waitingTask();
    await closing(task, "Approved", { account: ids.mail, id: "bank-transfer" });
    const item = await user!.client.from("items").select("status").eq("id", task).single();
    expect(item.data?.status, "the task is done").toBe("done");
    const under = await user!.client.from("items").select("type, title").eq("parent_item_id", task).is("deleted_at", null);
    expect(under.data, "its result hangs from it as a decision").toEqual([{ type: "decision", title: "Approved" }]);
    const links = await user!.client.from("mail_links").select("account_id, message_id").eq("item_id", task);
    expect(links.data, "the message that answered it stays linked to it").toEqual([{ account_id: ids.mail, message_id: "bank-transfer" }]);
  }

  it("closes a task with the result the person gives and the message that answered it", async () => {
    await closedWithItsResult(close);
  });

  it("its twins: a closing that skips one of its three parts fails that part", async () => {
    const markDone = (task: string) => callTool("update_item", context(), { id: task, status: "done" });
    const decide = (task: string, outcome: string) => user!.client.from("items").insert({ owner_id: user!.id, node_id: ids.client, parent_item_id: task, type: "decision", title: outcome });
    const link = (task: string, reply: Reply) => callTool("link_mail", context(), { account: reply.account, id: reply.id, task });
    await failsWith(
      () =>
        closedWithItsResult(async (task, outcome, reply) => {
          await decide(task, outcome);
          await link(task, reply);
        }),
      "the task is done",
    );
    await failsWith(
      () =>
        closedWithItsResult(async (task, _outcome, reply) => {
          await markDone(task);
          await link(task, reply);
        }),
      "its result hangs from it as a decision",
    );
    await failsWith(
      () =>
        closedWithItsResult(async (task, outcome) => {
          await markDone(task);
          await decide(task, outcome);
        }),
      "the message that answered it stays linked to it",
    );
  });
});

describe("what reading the mail costs in requests of the Worker's own", () => {
  // A Worker on Cloudflare's free plan makes at most 50 requests of its own per request it serves —every fetch counts, to
  // Google and to Supabase alike— and that request fails whole past them (Cloudflare Workers, «Limits»: 50 subrequests
  // per request on the free plan, 10,000 on the paid one). Counted here for a workspace whose accounts all read mail and
  // whose task waits for a message: the sidebar's count (`list_tree` with `withMail`) and the Mail page's list
  // (`list_mail` over every account, 50 messages each), with every token expired, so each account's renewal and its
  // storing are part of the cost, and with what the route that runs the call asks on its own.
  const BUDGET = 50;
  let owner: DisposableUser | undefined;
  let place = "";
  let waiting = "";
  let readers = 0;
  let firstReader = "";
  const ownerContext = (): ToolContext => ({ db: owner!.client, ownerId: owner!.id, source: "manual", mail: gmailMailSource(deps) });
  const today = () => new Date().toISOString().slice(0, 10);
  // A context per call, as each request of the screens builds its own: nothing one call read serves the next.
  const mailPage = () => callTool("list_mail", ownerContext(), { limit: 50 });
  const sidebar = () => callTool("list_tree", ownerContext(), { today: today(), withMail: true });
  // How many accounts fit in the budget past what a call asks whatever its accounts.
  const fits = (fixed: number, perAccount: number) => Math.floor((BUDGET - fixed) / perAccount);

  type Cost = { gmail: number; token: number; supabase: number; total: number };

  // What one run asked: Google's requests through the simulated Google —the renewals of the tokens apart—, and Supabase's
  // —its tables, its functions, and its auth server— through the process's fetch, which every Supabase client of the
  // suite calls. A request to anywhere else would be a cost this count does not see, so it fails the count.
  async function costOf<T>(run: () => Promise<T>): Promise<{ cost: Cost; result: T }> {
    forget();
    const spy = vi.spyOn(globalThis, "fetch");
    const settled = await run().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const urls = spy.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
    spy.mockRestore();
    if (!settled.ok) throw settled.error;
    expect(urls.filter((url) => !/\/(rest|auth)\/v1\//.test(url))).toEqual([]);
    const token = calls.filter((call) => call.endsWith("/token")).length;
    const gmail = calls.length - token;
    return { cost: { gmail, token, supabase: urls.length, total: gmail + token + urls.length }, result: settled.value };
  }

  // Every account of the workspace with its stored token expired, or valid for an hour more.
  async function tokens(state: "expired" | "valid") {
    const stored =
      state === "expired"
        ? { access_token_expires_at: "2020-01-01T00:00:00Z" }
        : { access_token: await encrypt(deps.key, "token-mail"), access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString() };
    const { error } = await serviceClient().from("google_accounts").update(stored).eq("owner_id", owner!.id);
    if (error) throw new Error(error.message);
  }

  // Accounts that read mail, hanging from the workspace's client, up to `count`.
  async function withReaders(count: number) {
    for (; readers < count; readers++) {
      const id = await insertAccount(`reader-${readers + 1}@example.com`, "refresh-mail", ALL, { owner: owner!, node: place });
      firstReader ||= id;
    }
  }

  const cutCount = { accountId: expect.any(String), accountEmail: expect.any(String), reason: expect.stringMatching(/^only the latest \d+ unread messages were counted$/) };

  beforeAll(async () => {
    owner = await createDisposableUser("gmail-cost");
    const node = await owner.client.from("nodes").insert({ owner_id: owner.id, kind: "client", name: "Northwind" }).select("id").single();
    if (node.error) throw new Error(node.error.message);
    place = node.data.id;
    // A task that waits for a message in every account of its place, as in a workspace in use: its possible replies are
    // read one account at a time.
    const task = await owner.client.from("items").insert({ owner_id: owner.id, node_id: place, type: "task", title: "Wait for the signed contract" }).select("id").single();
    if (task.error) throw new Error(task.error.message);
    waiting = task.data.id;
    const waits = await owner.client.from("task_mail").insert({ item_id: task.data.id, owner_id: owner.id, waits_for: "Northwind" });
    if (waits.error) throw new Error(waits.error.message);
  }, 60_000);

  afterAll(async () => {
    if (owner) await deleteDisposableUsers([owner]);
  }, 60_000);

  it("costs each account its renewal and its storing, a search, a batch, and its unread count, so a place fits eight in the list", async () => {
    const measured: Array<{ accounts: number; page: Cost; sidebar: Cost }> = [];
    for (let accounts = 1; accounts <= 3; accounts++) {
      await withReaders(accounts);
      await tokens("expired");
      const page = await costOf(mailPage);
      // A call that failed would ask less and read as a cheaper one.
      expect(page.result).toMatchObject({ ok: true, unread: accounts, failures: [] });
      await tokens("expired");
      const side = await costOf(sidebar);
      expect(side.result).toMatchObject({ ok: true, mail: { unread: accounts, failures: [] } });
      measured.push({ accounts, page: page.cost, sidebar: side.cost });
    }
    expect(measured).toEqual([
      { accounts: 1, page: { gmail: 3, token: 1, supabase: 8, total: 12 }, sidebar: { gmail: 1, token: 1, supabase: 8, total: 10 } },
      { accounts: 2, page: { gmail: 6, token: 2, supabase: 9, total: 17 }, sidebar: { gmail: 2, token: 2, supabase: 9, total: 13 } },
      { accounts: 3, page: { gmail: 9, token: 3, supabase: 10, total: 22 }, sidebar: { gmail: 3, token: 3, supabase: 10, total: 16 } },
    ]);
    // The count sees the renewals: with every token valid, each account asks Google for no token and stores none.
    await tokens("valid");
    expect((await costOf(mailPage)).cost).toEqual({ gmail: 9, token: 0, supabase: 7, total: 16 });
    expect((await costOf(sidebar)).cost).toEqual({ gmail: 3, token: 0, supabase: 7, total: 10 });
    // What each account adds, and what the call asks whatever its accounts, read from the counts; the screens' route adds
    // who is signed in (below).
    const per = (kind: "page" | "sidebar") => measured[2][kind].total - measured[1][kind].total;
    const fixed = (kind: "page" | "sidebar") => measured[0][kind].total - per(kind);
    expect({ page: fits(1 + fixed("page"), per("page")), sidebar: fits(1 + fixed("sidebar"), per("sidebar")) }).toEqual({ page: 8, sidebar: 14 });
  });

  it("reads a task's possible replies one account per request, so a request costs the same however many accounts its place holds", async () => {
    // An answer filed away from the inbox, so the list and its count above read what they read.
    const contract: Stored = {
      id: "contract",
      threadId: "contract",
      labelIds: [],
      internalDate: String(Date.now() + 3_600_000),
      snippet: "Signed contract",
      payload: { mimeType: "text/plain", headers: headers("Northwind <legal@northwind.example>", "Signed contract"), body: { data: encode("Signed.") } },
    };
    mailbox.push(contract);
    try {
      const measured: Cost[] = [];
      for (let accounts = 1; accounts <= 3; accounts++) {
        await withReaders(accounts);
        await tokens("expired");
        const read = await costOf(() => callTool("list_task_replies", ownerContext(), { task: waiting, account: firstReader }));
        expect(read.result).toMatchObject({ ok: true, replies: [expect.objectContaining({ id: "contract" })], failures: [] });
        measured.push(read.cost);
      }
      // One account's renewal and its storing, its search and its batch, and the task's own reads, whatever else the place
      // holds.
      expect(measured).toEqual([measured[0], measured[0], measured[0]]);
      expect(measured[0]).toEqual({ gmail: 2, token: 1, supabase: 9, total: 12 });
    } finally {
      mailbox.splice(mailbox.indexOf(contract), 1);
    }
  });

  it("costs an account whose unread count runs to its last page three searches more, so a place fits five in the list", async () => {
    await withReaders(3);
    trouble.endlessUnread = true;
    try {
      await tokens("expired");
      const page = await costOf(mailPage);
      expect(page.result).toMatchObject({ ok: true, failures: [cutCount, cutCount, cutCount] });
      await tokens("expired");
      const side = await costOf(sidebar);
      expect(side.result).toMatchObject({ ok: true, mail: { failures: [cutCount, cutCount, cutCount] } });
      expect({ page: page.cost, sidebar: side.cost }).toEqual({
        page: { gmail: 18, token: 3, supabase: 10, total: 31 },
        sidebar: { gmail: 12, token: 3, supabase: 10, total: 25 },
      });
      // What the call asks whatever its accounts stays a single page's (7 and 7, above); each account asks the rest.
      const perAccount = { page: (page.cost.total - 7) / 3, sidebar: (side.cost.total - 7) / 3 };
      expect(perAccount).toEqual({ page: 8, sidebar: 6 });
      expect({ page: fits(1 + 7, perAccount.page), sidebar: fits(1 + 7, perAccount.sidebar) }).toEqual({ page: 5, sidebar: 7 });
    } finally {
      clearTrouble();
    }
  });

  it("leaves room for the route that runs the call: the screens', the coding agent's, and a chat turn's with its model", async () => {
    await withReaders(3);
    // The screens' route asks the auth server who is signed in (`sessionContext`, one more when the person's session
    // expired and the route renews it first); the coding agent's finds its token by its hash, one read whatever the token.
    expect((await costOf(() => currentUser(owner!.client))).cost).toEqual({ gmail: 0, token: 0, supabase: 1, total: 1 });
    const agent = new Request("http://localhost/api/mcp", { headers: { authorization: `Bearer cwa_${"a".repeat(43)}` } });
    expect((await costOf(() => authenticateAgent(agent, serviceClient()))).cost).toEqual({ gmail: 0, token: 0, supabase: 1, total: 1 });
    // A chat turn over everything that reads the mail (`/api/chat`): who is signed in, a unit of the day, the conversation,
    // the prompt's tree —which the turn's tools then read from memory— and the list; past what is counted here, a request
    // to the model per step and the turn's storing.
    const turn = async () => {
      const ctx: ToolContext = { ...ownerContext(), source: "chat" };
      await currentUser(owner!.client);
      await takeUsageFor(serviceClient(), { id: owner!.id, isAnonymous: false }, "chat_message");
      await loadHistory(owner!.client, null);
      await systemPrompt(ctx, "UTC");
      return callTool("list_mail", ctx, {});
    };
    await tokens("expired");
    const nominal = await costOf(turn);
    expect(nominal.result).toMatchObject({ ok: true, failures: [] });
    expect(nominal.cost).toEqual({ gmail: 9, token: 3, supabase: 15, total: 27 });
    trouble.endlessUnread = true;
    try {
      await tokens("expired");
      const full = await costOf(turn);
      expect(full.result).toMatchObject({ ok: true, failures: [cutCount, cutCount, cutCount] });
      expect(full.cost).toEqual({ gmail: 18, token: 3, supabase: 15, total: 36 });
    } finally {
      clearTrouble();
    }
    // The turn's own requests: what is left of its three accounts at 5 each (above), its model's steps, and its storing.
    const own = nominal.cost.total - 3 * 5 + MAX_STEPS + 1;
    expect(own).toBe(19);
    // A turn that reads the mail once fits six accounts, and three whose unread count runs to its last page.
    expect({ nominal: fits(own, 5), full: fits(own, 8) }).toEqual({ nominal: 6, full: 3 });
  });
});
