import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CALENDAR_LIST_SCOPE, EVENTS_SCOPE, GMAIL_READ_SCOPE, type Fetch, type GmailPart } from "@/lib/google/api";
import { decrypt, encrypt, importKey, newKeyBase64 } from "@/lib/google/crypto";
import type { GoogleDeps } from "@/lib/google/events";
import { gmailMailSource } from "@/lib/google/gmail";
import type { MailAccount } from "@/lib/mail/source";
import type { ReviewJudge } from "@/lib/review/judge";
import { runDailyReview, type ReviewTask } from "@/lib/review/run";
import type { ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";






let user: DisposableUser | undefined;
let deps: GoogleDeps;
const ids = { client: "", other: "", mail: "", calendarOnly: "", revoked: "", late: "", gone: "" };

const calls: string[] = [];
const searches: string[] = [];
const batchFormats: string[] = [];

const trouble = {
  
  ghost: false,
  
  search: null as number | null,
  unreadSearch: null as number | null,
  
  endlessUnread: false,
  
  leakSent: false,
  
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
    
    id: "m3",
    threadId: "t3",
    labelIds: ["CATEGORY_UPDATES"],
    internalDate: at("2026-10-29T09:00:00Z"),
    snippet: "Transfer received",
    payload: { mimeType: "text/html", headers: headers("Bank <alerts@bank.example>", "Transfer received"), body: { data: encode("<p>Transfer received</p>") } },
  },
  {
    
    id: "m4",
    threadId: "t1",
    labelIds: ["SENT"],
    internalDate: at("2026-10-29T15:10:00Z"),
    snippet: "Thanks!",
    payload: { mimeType: "text/plain", headers: headers("studio@example.com", "Re: Your app review was approved"), body: { data: encode("Thanks!") } },
  },
  {
    
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



function search(q: string): Stored[] {
  const after = /after:(\d+)/.exec(q);
  const senders = [...q.matchAll(/from:\(([^)]*)\)/g)].map(([, words]) => words.toLowerCase().split(/\s+/).filter(Boolean));
  const loose = q
    .replace(/from:\([^)]*\)/g, " ")
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
      if (after && Number(message.internalDate) / 1000 <= Number(after[1])) return false;
      const from = fromOf(message).toLowerCase();
      if (senders.length > 0 && !senders.some((words) => words.every((word) => from.includes(word)))) return false;
      const text = `${from} ${subjectOf(message)} ${message.snippet}`.toLowerCase();
      return loose.every((word) => text.includes(word));
    })
    .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
}


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
  
  if (token === "token-dead") return json(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
  if (!READERS.has(token)) return json(403, { error: { status: "PERMISSION_DENIED" } });
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
      const planned = trouble.flaky.get(decodeURIComponent(id))?.shift();
      const message = planned ? null : answer(decodeURIComponent(id), new URLSearchParams(query));
      const status = planned ? `${planned} Trouble` : message ? "200 OK" : "404 Not Found";
      const payload = message ? JSON.stringify(message) : JSON.stringify({ error: { code: planned ?? 404 } });
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
  options: { node?: string; status?: "active" | "revoked"; access?: { token: string; until: string } } = {},
) {
  const service = serviceClient();
  const { data, error } = await service
    .from("google_accounts")
    .insert({
      owner_id: user!.id,
      email,
      refresh_token: await encrypt(deps.key, refresh),
      
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
    
    expect(messages[0]).not.toHaveProperty("html");
    expect(failures).toEqual(
      expect.arrayContaining([
        { accountId: ids.calendarOnly, accountEmail: "calendar@example.com", reason: expect.stringMatching(/reading mail was not granted/) },
        { accountId: ids.revoked, accountEmail: "gone@example.com", reason: expect.stringMatching(/access was revoked/) },
      ]),
    );
    expect(failures).toHaveLength(2);
    
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
    
    const { messages, failures } = await gmailMailSource(deps).unread({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()] });
    expect(failures).toEqual([]);
    expect(messages).toEqual([{ accountId: ids.mail, id: "m1" }]);
  });

  it("reads whole what arrived since a moment, archived included, and never what the account sent", async () => {
    const { messages, failures, more } = await gmailMailSource(deps).read({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()], since: "2026-10-29T00:00:00Z" });
    expect(failures).toEqual([]);
    expect(more).toEqual([]);
    expect(messages.map((message) => message.id)).toEqual(["m1", "m3"]);
    expect(messages[0].text).toBe("Your app review was approved.");
    expect(messages[0].html).toContain("<b>approved</b>");
    expect(messages[1]).toMatchObject({ html: "<p>Transfer received</p>", text: null });
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
      
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain(`account ${ids.mail}`);
      expect(logged).toContain("500 × 1");
      expect(logged).not.toContain("studio@example.com");
    } finally {
      spy.mockRestore();
      clearTrouble();
    }
  });

  it("counts a message whose content cannot be decoded apart, and still reads the rest whole", async () => {
    const broken: Stored = {
      id: "m6",
      threadId: "t6",
      labelIds: ["INBOX"],
      internalDate: at("2026-10-29T17:00:00Z"),
      snippet: "Broken",
      payload: { mimeType: "text/plain", headers: headers("Broken <broken@example.com>", "Broken"), body: { data: "@@@" } },
    };
    mailbox.push(broken);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { messages, failures } = await gmailMailSource(deps).read({ db: user!.client, ownerId: user!.id, accounts: [mailAccount()], since: "2026-10-29T00:00:00Z" });
      expect(messages.map((message) => message.id)).toEqual(["m1", "m3"]);
      expect(failures).toEqual([{ accountId: ids.mail, accountEmail: "studio@example.com", reason: "1 of 3 messages could not be read" }]);
    } finally {
      spy.mockRestore();
      mailbox.splice(mailbox.indexOf(broken), 1);
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
      
      expect(listed.unreadByAccount[ids.mail]).toBeGreaterThan(0);
    } finally {
      clearTrouble();
    }
    trouble.unreadSearch = 500;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const listed = (await callTool("list_mail", context(), { node: ids.client })) as unknown as Listed;
      
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

describe("the daily review over a busy inbox", () => {
  
  let seen: ReviewTask[] = [];
  const watcher: ReviewJudge = {
    provider: "simulated",
    async review(tasks) {
      seen = tasks;
      return { failures: [] };
    },
  };
  const planted: Stored[] = [];
  let waiting = "";

  beforeAll(async () => {
    const { data, error } = await user!.client.from("items").insert({ owner_id: user!.id, node_id: ids.client, type: "task", title: "Wait for the transfer" }).select("id, created_at").single();
    if (error) throw new Error(error.message);
    waiting = data.id;
    const waits = await user!.client.from("task_mail").insert({ item_id: data.id, owner_id: user!.id, account_id: ids.mail, expect_from: "Bayside Bank" });
    if (waits.error) throw new Error(waits.error.message);
    
    const start = Date.parse(data.created_at) + 60_000;
    planted.push({
      id: "answer",
      threadId: "answer",
      labelIds: ["INBOX", "UNREAD"],
      internalDate: String(start),
      snippet: "The transfer arrived",
      payload: { mimeType: "text/plain", headers: headers("Bayside Bank <alerts@bayside.example>", "Transfer received"), body: { data: encode("The transfer arrived.") } },
    });
    for (let index = 0; index < 60; index++) {
      planted.push({
        id: `news-${index}`,
        threadId: `news-${index}`,
        labelIds: ["INBOX"],
        internalDate: String(start + 1000 * (index + 1)),
        snippet: "This week",
        payload: { mimeType: "text/plain", headers: headers("Newsletter <news@example.com>", `Issue ${index}`), body: { data: encode("This week.") } },
      });
    }
    mailbox.push(...planted);
  });

  afterAll(() => {
    for (const message of planted) mailbox.splice(mailbox.indexOf(message), 1);
  });

  const today = () => new Date().toISOString().slice(0, 10);

  it("finds the answer a task waits for under more mail than one read brings", async () => {
    const run = await runDailyReview(context(), { today: today(), requested: true, judge: watcher });
    if (!run.ok) throw new Error(run.message);
    const task = seen.find((entry) => entry.id === waiting)!;
    expect(task.messages.map((message) => message.id)).toEqual(["answer"]);
    expect(run.failures).toEqual([]);
    
    expect(searches.some((q) => q.includes("from:(Bayside Bank)"))).toBe(true);
  });

  it("says when a task that waits for any sender may have its answer past what was read", async () => {
    const { data, error } = await user!.client.from("items").insert({ owner_id: user!.id, node_id: ids.client, type: "task", title: "Wait for any reply" }).select("id").single();
    if (error) throw new Error(error.message);
    const waits = await user!.client.from("task_mail").insert({ item_id: data.id, owner_id: user!.id, account_id: ids.mail });
    if (waits.error) throw new Error(waits.error.message);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await runDailyReview(context(), { today: today(), requested: true, judge: watcher });
      if (!run.ok) throw new Error(run.message);
      expect(run.failures).toEqual([expect.stringMatching(/^reading the mail of studio@example\.com for a task that waits for any sender: only the latest 50 messages/)]);
      expect(run.review!.failures).toBe(1);
    } finally {
      spy.mockRestore();
      await user!.client.from("task_mail").delete().eq("item_id", data.id);
    }
  });
});
