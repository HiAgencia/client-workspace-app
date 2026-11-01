import { isToolUIPart, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadHistory } from "@/lib/chat/history";
import { simulatedModel } from "@/lib/chat/simulated";
import { takeUsageFor } from "@/lib/chat/usage";
import { GMAIL_READ_SCOPE, type Fetch } from "@/lib/google/api";
import { connectAccount } from "@/lib/google/connect";
import { decrypt, encrypt, importKey, newKeyBase64 } from "@/lib/google/crypto";
import { googleCalendarWriter, googleEventsSource, type GoogleDeps } from "@/lib/google/events";
import { gmailMailSource } from "@/lib/google/gmail";
import type { MailSource } from "@/lib/mail/source";
import { readSession } from "@/lib/supabase/server";
import type { EventsSource, ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";
import { chatTurn } from "../support/chat-turn";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";




let user: DisposableUser | undefined;
let deps: GoogleDeps;
const ids = { root: "", project: "", leaf: "", agency: "", landing: "", revoked: "" };
const calls: string[] = [];
const FULL_GRANT =
  "openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email";
let grantedScope = FULL_GRANT;
let written = 0;

const googleEvents: Record<string, unknown[]> = {
  "token-agency": [
    { id: "a1", summary: "Agency standup", start: { dateTime: "2026-11-03T12:00:00Z" }, end: { dateTime: "2026-11-03T12:15:00Z" } },
    { id: "a2", summary: "Cancelled", status: "cancelled", start: { dateTime: "2026-11-03T13:00:00Z" }, end: { dateTime: "2026-11-03T14:00:00Z" } },
  ],
  "token-landing": [{ id: "l1", summary: "Landing review", start: { date: "2026-11-02" }, end: { date: "2026-11-03" } }],
  "token-late": [{ id: "t1", summary: "Late review", start: { date: "2026-11-04" }, end: { date: "2026-11-05" } }],
  "token-reader": [{ id: "r1", summary: "Reader sync", start: { dateTime: "2026-11-04T12:00:00Z" }, end: { dateTime: "2026-11-04T12:30:00Z" } }],
};

const fakeGoogle: Fetch = async (input, init) => {
  const url = new URL(String(input));
  calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  if (url.pathname === "/token") {
    const form = new URLSearchParams(String(init?.body));
    if (form.get("grant_type") === "refresh_token") {
      const refresh = form.get("refresh_token");
      if (refresh === "refresh-revoked") return json(400, { error: "invalid_grant" });
      return json(200, { access_token: `token-${refresh?.replace("refresh-", "")}`, expires_in: 3600 });
    }
    return json(200, {
      access_token: "token-new",
      refresh_token: "refresh-new",
      expires_in: 3600,
      scope: grantedScope,
    });
  }
  if (url.pathname === "/v1/userinfo") return json(200, { email: "New.Account@example.com", email_verified: true });
  if (url.pathname.endsWith("/calendarList")) {
    return json(200, { items: [{ id: "primary-cal", summary: "Main", primary: true, backgroundColor: "#3366ff" }, { id: "holidays", summary: "Holidays" }] });
  }
  if (url.pathname.includes("/events")) {
    const token = (init?.headers as Record<string, string>).Authorization.replace("Bearer ", "");
    
    if (token === "token-dead") return json(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    const list = (googleEvents[token] ??= []) as Array<Record<string, unknown>>;
    const eventId = decodeURIComponent(url.pathname.split("/events/")[1] ?? "");
    const method = init?.method ?? "GET";
    
    if (method === "POST") {
      const created = { id: `w${++written}`, htmlLink: "https://calendar.example/e", ...JSON.parse(String(init?.body)) };
      list.push(created);
      return json(200, created);
    }
    if (eventId) {
      const at = list.findIndex((event) => event.id === eventId);
      if (at === -1) return json(404, { error: { status: "NOT_FOUND" } });
      if (method === "PATCH") {
        list[at] = { ...list[at], ...JSON.parse(String(init?.body)) };
        return json(200, list[at]);
      }
      if (method === "DELETE") {
        list.splice(at, 1);
        return new Response(null, { status: 204 });
      }
      return json(200, list[at]);
    }
    return json(200, { items: list });
  }
  return json(404, { error: "not_found" });
};

async function insertNode(kind: "client" | "project" | "subproject", name: string, parent?: string) {
  const { data, error } = await user!.client
    .from("nodes")
    .insert({ owner_id: user!.id, kind, name, parent_id: parent ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function insertAccount(email: string, refresh: string, node: string, owner = user!) {
  const service = serviceClient();
  const { data, error } = await service
    .from("google_accounts")
    .insert({
      owner_id: owner.id,
      email,
      refresh_token: await encrypt(deps.key, refresh),
      
      access_token: await encrypt(deps.key, "stale"),
      access_token_expires_at: "2020-01-01T00:00:00Z",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const attached = await service.from("node_accounts").insert({ node_id: node, account_id: data.id });
  if (attached.error) throw new Error(attached.error.message);
  const calendar = await service
    .from("account_calendars")
    .insert({ account_id: data.id, calendar_id: "primary", summary: email, selected: true });
  if (calendar.error) throw new Error(calendar.error.message);
  return data.id;
}

beforeAll(async () => {
  user = await createDisposableUser("google");
  deps = { service: serviceClient(), key: await importKey(newKeyBase64()), client: { clientId: "id", clientSecret: "secret" }, fetch: fakeGoogle };
  ids.root = await insertNode("client", "Acme");
  ids.project = await insertNode("project", "Web", ids.root);
  ids.leaf = await insertNode("subproject", "Landing", ids.project);
  ids.agency = await insertAccount("agency@example.com", "refresh-agency", ids.root);
  ids.landing = await insertAccount("landing@example.com", "refresh-landing", ids.leaf);
  ids.revoked = await insertAccount("revoked@example.com", "refresh-revoked", ids.project);
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

const window = { from: "2026-11-01T00:00:00Z", to: "2026-11-08T00:00:00Z" };
const days = { fromDay: "2026-11-01", toDay: "2026-11-07" };

type EventRead = { id: string; title: string; start: string; allDay: boolean; origin: string; accountId: string; accountEmail: string; fromNodeId: string; linkedTaskIds: string[] };
type Read = { ok: boolean; toRead: string[]; events: EventRead[]; failures: Array<{ accountId: string; accountEmail: string; reason: string }> };

const readerContext = (owner = user!): ToolContext => ({ db: owner.client, ownerId: owner.id, source: "manual", events: googleEventsSource(deps) });


async function readWhole(ctx: ToolContext, name: "list_events" | "browse_events", input: Record<string, unknown>) {
  const first = (await callTool(name, ctx, input)) as unknown as Read;
  expect(first.ok).toBe(true);
  const rest = (await Promise.all(first.toRead.map((account) => callTool(name, ctx, { ...input, account })))) as unknown as Read[];
  const answers = [first, ...rest];
  return {
    events: answers.flatMap((answer) => answer.events).sort((a, b) => a.start.localeCompare(b.start)),
    failures: answers.flatMap((answer) => answer.failures),
  };
}

const eventsOf = (node: string) => readWhole(readerContext(), "list_events", { node, ...window });

describe("events from inherited accounts", () => {
  it("the subproject sees its own account and the inherited ones; a revoked one is reported, not fatal", async () => {
    const { events, failures } = await eventsOf(ids.leaf);
    expect(events.map((e) => e.title)).toEqual(["Landing review", "Agency standup"]);
    expect(events.find((e) => e.id === "l1")).toMatchObject({ allDay: true, fromNodeId: ids.leaf, accountEmail: "landing@example.com" });
    expect(events.find((e) => e.id === "a1")).toMatchObject({ allDay: false, fromNodeId: ids.root });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ accountEmail: "revoked@example.com" });
    expect(failures[0].reason).toMatch(/revoked/);
  });

  it("the root sees only its own account", async () => {
    
    const first = (await callTool("list_events", readerContext(), { node: ids.root, ...window })) as unknown as Read;
    expect(first.toRead).toEqual([]);
    expect(first.events.map((e) => e.accountEmail)).toEqual(["agency@example.com"]);
    expect(first.failures).toEqual([]);
  });

  it("a renewed token is stored encrypted, and a revoked account is marked", async () => {
    const { data } = await serviceClient().from("google_accounts").select("id, access_token, status").eq("owner_id", user!.id);
    const agency = data!.find((row) => row.id === ids.agency)!;
    expect(agency.access_token).not.toContain("token-agency");
    expect(await decrypt(deps.key, agency.access_token!)).toBe("token-agency");
    expect(data!.find((row) => row.id === ids.revoked)!.status).toBe("revoked");
  });

  it("a sample account of the demo asks Google nothing and is no failure", async () => {
    const service = serviceClient();
    const { data: sample, error } = await service.from("google_accounts").insert({ owner_id: user!.id, email: "sample@demo.example", is_demo: true }).select("id").single();
    if (error) throw new Error(error.message);
    try {
      await service.from("node_accounts").insert({ node_id: ids.leaf, account_id: sample.id });
      await service.from("account_calendars").insert({ account_id: sample.id, calendar_id: "primary", summary: "Sample", selected: true });
      calls.length = 0;
      const { events, failures } = await eventsOf(ids.leaf);
      expect(failures.map((failure) => failure.accountEmail)).toEqual(["revoked@example.com"]);
      expect(events.every((event) => event.accountId !== sample.id)).toBe(true);
      
      expect(calls.filter((call) => call.includes("/events")).length).toBe(2);
      const after = await service.from("google_accounts").select("status").eq("id", sample.id).single();
      expect(after.data?.status).toBe("active");
    } finally {
      await service.from("google_accounts").delete().eq("id", sample.id);
    }
  });

  it("browse_events says which tasks live in a Google event", async () => {
    const ctx = { db: user!.client, ownerId: user!.id, source: "manual" as const, events: googleEventsSource(deps) };
    const task = (await callTool("create_task", ctx, { node: ids.leaf, title: "Prepare the standup" })) as { ok: boolean; item: { id: string } };
    const other = (await callTool("create_task", ctx, { node: ids.leaf, title: "Not in an event" })) as { ok: boolean; item: { id: string } };
    expect((await callTool("link_task_event", ctx, { task: task.item.id, account: ids.agency, calendar: "primary", googleEvent: "a1" })).ok).toBe(true);
    const browsed = await readWhole(ctx, "browse_events", { node: ids.leaf, ...window, ...days });
    expect(browsed.events.find((event) => event.id === "a1")?.linkedTaskIds).toEqual([task.item.id]);
    expect(browsed.events.find((event) => event.id === "l1")?.linkedTaskIds).toEqual([]);
    expect(browsed.events.flatMap((event) => event.linkedTaskIds)).not.toContain(other.item.id);
    
    await callTool("delete_item", ctx, { id: task.item.id });
    const after = await readWhole(ctx, "browse_events", { node: ids.leaf, ...window, ...days });
    expect(after.events.find((event) => event.id === "a1")?.linkedTaskIds).toEqual([]);
  });

  it("list_events serves them through the tool layer, and another owner's id is not found", async () => {
    const ctx = { db: user!.client, ownerId: user!.id, source: "manual" as const, events: googleEventsSource(deps) };
    const result = await readWhole(ctx, "list_events", { node: "Acme / Web / Landing", ...window });
    expect(result.events.map((e) => e.title)).toEqual(["Landing review", "Agency standup"]);
    const other = await createDisposableUser("google-other");
    try {
      const foreign = await callTool("list_events", { db: other.client, ownerId: other.id, source: "manual", events: googleEventsSource(deps) }, { node: ids.leaf });
      expect(foreign).toMatchObject({ ok: false, code: "not_found" });
    } finally {
      await deleteDisposableUsers([other]);
    }
  });

  it("a token Google refused before its date is renewed once and read again, and a revoked grant marks the account", async () => {
    
    const node = await insertNode("client", "Late");
    const service = serviceClient();
    const accountIds: string[] = [];
    for (const [email, refresh] of [["late@example.com", "refresh-late"], ["revoked-late@example.com", "refresh-revoked"]]) {
      const { data, error } = await service
        .from("google_accounts")
        .insert({
          owner_id: user!.id,
          email,
          refresh_token: await encrypt(deps.key, refresh),
          access_token: await encrypt(deps.key, "token-dead"),
          access_token_expires_at: "2099-01-01T00:00:00Z",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      accountIds.push(data.id);
      await service.from("node_accounts").insert({ node_id: node, account_id: data.id });
      await service.from("account_calendars").insert({ account_id: data.id, calendar_id: "primary", summary: email, selected: true });
    }
    const { events, failures } = await eventsOf(node);
    expect(events.map((event) => event.title)).toEqual(["Late review"]);
    expect(failures).toEqual([{ accountId: accountIds[1], accountEmail: "revoked-late@example.com", reason: "access was revoked: connect the account again" }]);
    const { data } = await service.from("google_accounts").select("id, access_token, status").in("id", accountIds);
    const late = data!.find((row) => row.id === accountIds[0])!;
    expect(await decrypt(deps.key, late.access_token!)).toBe("token-late");
    expect(data!.find((row) => row.id === accountIds[1])!.status).toBe("revoked");
  });
});

describe("what reading the calendars costs in requests of the Worker's own", () => {
  
  
  
  const SIZES = [1, 3, 10];
  let owner: DisposableUser | undefined;
  let place = "";
  let inside = "";
  const readers: string[] = [];
  const ownerContext = () => readerContext(owner!);
  const range = { ...window, ...days };

  type Cost = { google: number; token: number; supabase: number; total: number };

  async function costOf<T>(run: () => Promise<T>): Promise<{ cost: Cost; result: T }> {
    calls.length = 0;
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
    const google = calls.length - token;
    return { cost: { google, token, supabase: urls.length, total: google + token + urls.length }, result: settled.value };
  }

  async function expireTokens() {
    const { error } = await serviceClient().from("google_accounts").update({ access_token_expires_at: "2020-01-01T00:00:00Z" }).eq("owner_id", owner!.id);
    if (error) throw new Error(error.message);
  }

  
  async function withReaders(count: number) {
    while (readers.length < count) readers.push(await insertAccount(`reader-${readers.length + 1}@example.com`, "refresh-reader", place, owner!));
    const extra = readers.splice(count);
    if (extra.length > 0) {
      const { error } = await serviceClient().from("google_accounts").delete().in("id", extra);
      if (error) throw new Error(error.message);
    }
  }

  async function acrossSizes(read: () => Promise<unknown>, sizes = SIZES): Promise<Cost[]> {
    const measured: Cost[] = [];
    for (const size of sizes) {
      await withReaders(size);
      await expireTokens();
      const { cost, result } = await costOf(read);
      
      expect(result).toMatchObject({ ok: true });
      measured.push(cost);
    }
    return measured;
  }

  const grew = (measured: Cost[]) => measured.some((cost) => cost.total !== measured[0].total);

  beforeAll(async () => {
    owner = await createDisposableUser("google-cost");
    const node = await owner.client.from("nodes").insert({ owner_id: owner.id, kind: "client", name: "Northwind" }).select("id").single();
    if (node.error) throw new Error(node.error.message);
    place = node.data.id;
    const project = await owner.client.from("nodes").insert({ owner_id: owner.id, kind: "project", name: "Launch", parent_id: place }).select("id").single();
    if (project.error) throw new Error(project.error.message);
    inside = project.data.id;
  }, 60_000);

  afterAll(async () => {
    if (owner) await deleteDisposableUsers([owner]);
  }, 60_000);

  it("reads one account in a request that costs the same with 1, 3 and 10 accounts", async () => {
    const reads: Array<[string, () => Promise<unknown>]> = [
      ["browse_events over everything", () => callTool("browse_events", ownerContext(), { ...range, account: readers[0] })],
      ["browse_events from a node below", () => callTool("browse_events", ownerContext(), { ...range, node: inside, account: readers[0] })],
      ["list_events", () => callTool("list_events", ownerContext(), { ...window, node: place, account: readers[0] })],
    ];
    for (const [name, read] of reads) {
      const measured = await acrossSizes(read);
      expect({ name, measured }).toEqual({ name, measured: [measured[0], measured[0], measured[0]] });
      
      expect(measured[0].google).toBe(1);
      expect(measured[0].token).toBe(1);
    }
  }, 180_000);

  it("its twin: a request that reads every account grows with them and fails the rule", async () => {
    const measured = await acrossSizes(async () => {
      await Promise.all(readers.map((id) => callTool("browse_events", ownerContext(), { ...range, account: id })));
      return { ok: true };
    });
    expect(grew(measured)).toBe(true);
  }, 180_000);

  it("what grows inside one account is its chosen calendars, one read of Google each", async () => {
    await withReaders(1);
    const calendar = await serviceClient().from("account_calendars").insert({ account_id: readers[0], calendar_id: "second", summary: "Second", selected: true });
    expect(calendar.error).toBeNull();
    try {
      await expireTokens();
      const { cost } = await costOf(() => callTool("browse_events", ownerContext(), { ...range, account: readers[0] }));
      expect(cost.google).toBe(2);
      expect(cost.token).toBe(1);
    } finally {
      await serviceClient().from("account_calendars").delete().eq("account_id", readers[0]).eq("calendar_id", "second");
    }
  });

  it("a read that names no account, over several, asks Google nothing and lists them all, at any size", async () => {
    for (const [name, read, listed] of [
      ["browse_events", () => callTool("browse_events", ownerContext(), range), "toRead"],
      ["list_events", () => callTool("list_events", ownerContext(), { ...window, node: place }), "toRead"],
      ["get_overview", () => callTool("get_overview", ownerContext(), { node: place }), "eventsToRead"],
    ] as Array<[string, () => Promise<unknown>, string]>) {
      const measured: Cost[] = [];
      for (const size of [3, 10]) {
        await withReaders(size);
        await expireTokens();
        const { cost, result } = await costOf(read);
        expect({ name, listed: [...(result as Record<string, string[]>)[listed]].sort() }).toEqual({ name, listed: [...readers].sort() });
        expect(cost.google + cost.token).toBe(0);
        measured.push(cost);
      }
      expect({ name, grew: grew(measured) }).toEqual({ name, grew: false });
    }
  }, 180_000);

  it("a lone connected account comes in the first request, with the place's own events beside it", async () => {
    await withReaders(1);
    await expireTokens();
    const own = (await callTool("create_event", ownerContext(), { node: place, title: "Own review", startsOn: "2026-11-03" })) as { ok: boolean };
    expect(own.ok).toBe(true);
    for (const [name, read, listed] of [
      ["browse_events", () => callTool("browse_events", ownerContext(), range), "toRead"],
      ["list_events", () => callTool("list_events", ownerContext(), { ...window, node: place }), "toRead"],
    ] as Array<[string, () => Promise<unknown>, string]>) {
      const answer = (await read()) as unknown as Read;
      expect({ name, listed: (answer as unknown as Record<string, string[]>)[listed] }).toEqual({ name, listed: [] });
      expect(answer.events.map((event) => [event.title, event.origin])).toEqual([
        ["Own review", "local"],
        ["Reader sync", "google"],
      ]);
    }
    
    const named = (await callTool("browse_events", ownerContext(), { ...range, account: readers[0] })) as unknown as Read;
    expect(named.events.map((event) => event.title)).toEqual(["Reader sync"]);
    
    calls.length = 0;
    const agenda = (await callTool("get_overview", ownerContext(), { node: place })) as unknown as { eventsToRead: string[] };
    expect(agenda.eventsToRead).toEqual([]);
    expect(calls.filter((call) => call.includes("/events"))).toHaveLength(1);
  });

  it("an account says the node it is seen from, nearest to the node asked, and the first it hangs from over everything", async () => {
    await withReaders(1);
    const service = serviceClient();
    const attached = await service.from("node_accounts").insert({ node_id: inside, account_id: readers[0] });
    expect(attached.error).toBeNull();
    try {
      const fromInside = (await callTool("browse_events", ownerContext(), { ...range, node: inside, account: readers[0] })) as unknown as Read;
      expect(fromInside.events.map((event) => event.fromNodeId)).toEqual([inside]);
      const fromAbove = (await callTool("browse_events", ownerContext(), { ...range, node: place, account: readers[0] })) as unknown as Read;
      expect(fromAbove.events.map((event) => event.fromNodeId)).toEqual([place]);
      
      const everything = (await callTool("browse_events", ownerContext(), { ...range, account: readers[0] })) as unknown as Read;
      const tree = (await callTool("list_tree", ownerContext(), { withMail: true })) as unknown as { mail: { accounts: Array<{ id: string; nodeId: string; nodeIds: string[] }> } };
      const hanging = tree.mail.accounts.find((account) => account.id === readers[0])!;
      expect([...hanging.nodeIds].sort()).toEqual([place, inside].sort());
      expect(everything.events.map((event) => event.fromNodeId)).toEqual([hanging.nodeId]);
    } finally {
      await service.from("node_accounts").delete().eq("node_id", inside).eq("account_id", readers[0]);
    }
  });

  it("a scoped access reads no node out of its reach in where an inherited account hangs", async () => {
    await withReaders(1);
    const scoped = { ...ownerContext(), db: serviceClient(), scopeNodeId: inside, source: "agent" as const, agentLabel: "laptop" };
    const tree = (await callTool("list_tree", scoped, { withMail: true })) as unknown as { mail: { accounts: Array<{ id: string; nodeId: string | null; nodeIds: string[] }> } };
    expect(tree.mail.accounts.find((account) => account.id === readers[0])).toMatchObject({ nodeId: null, nodeIds: [] });
    
    type Said = { accounts: Array<{ nodeId: string | null }>; events: EventRead[] };
    const message = { id: "m1", threadId: "t1", accountId: readers[0], accountEmail: "reader-1@example.com", from: { name: null, email: "a@example.com" }, to: [], subject: "Hello", snippet: "", receivedAt: "2026-11-03T12:00:00Z", unread: false, important: false };
    const mail = { list: async () => ({ messages: [message], failures: [] }), unread: async () => ({ messages: [], failures: [] }) } as unknown as MailSource;
    for (const [name, read] of [
      ["browse_events", (ctx: ToolContext) => callTool("browse_events", ctx, { ...range, account: readers[0] })],
      ["browse_events, the first read", (ctx: ToolContext) => callTool("browse_events", ctx, range)],
      ["list_events", (ctx: ToolContext) => callTool("list_events", ctx, { ...window, account: readers[0] })],
      ["list_events, the first read", (ctx: ToolContext) => callTool("list_events", ctx, window)],
    ] as Array<[string, (ctx: ToolContext) => Promise<unknown>]>) {
      const said = (await read(scoped)) as unknown as Said;
      expect({ name, accounts: said.accounts.map((account) => account.nodeId) }).toEqual({ name, accounts: [null] });
      expect({ name, from: said.events.filter((event) => event.origin === "google").map((event) => event.fromNodeId) }).toEqual({ name, from: [""] });
      
      const whole = (await read({ ...ownerContext(), ...(name.startsWith("list_events") ? { scopeNodeId: place } : {}) })) as unknown as Said;
      expect({ name, accounts: whole.accounts.map((account) => account.nodeId) }).toEqual({ name, accounts: [place] });
      expect({ name, from: whole.events.filter((event) => event.origin === "google").map((event) => event.fromNodeId) }).toEqual({ name, from: [place] });
    }
    const inboxOf = async (ctx: ToolContext) =>
      (await callTool("list_mail", { ...ctx, mail }, { account: readers[0] })) as unknown as { accounts: Array<{ nodeId: string | null }>; groups: { earlier: { messages: Array<{ place: { nodeId: string } | null }> } } };
    const scopedInbox = await inboxOf(scoped);
    expect(scopedInbox.accounts.map((account) => account.nodeId)).toEqual([null]);
    expect(scopedInbox.groups.earlier.messages.map((row) => row.place)).toEqual([null]);
    const wholeInbox = await inboxOf(ownerContext());
    expect(wholeInbox.accounts.map((account) => account.nodeId)).toEqual([place]);
    expect(wholeInbox.groups.earlier.messages.map((row) => row.place?.nodeId)).toEqual([place]);
  });

  it("list_events brings the whole-day events of exactly the days it is asked for", async () => {
    await withReaders(0);
    const node = await owner!.client.from("nodes").insert({ owner_id: owner!.id, kind: "client", name: "Days" }).select("id").single();
    if (node.error) throw new Error(node.error.message);
    try {
      for (const day of ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]) {
        const made = (await callTool("create_event", ownerContext(), { node: node.data.id, title: day, startsOn: day })) as { ok: boolean };
        expect(made.ok).toBe(true);
      }
      const daysOf = async (from: string, to?: string) => {
        const read = (await callTool("list_events", ownerContext(), { node: node.data.id, from, ...(to ? { to } : {}) })) as unknown as Read;
        expect(read.ok).toBe(true);
        return read.events.map((event) => event.title);
      };
      expect(await daysOf("2026-11-05", "2026-11-05")).toEqual(["2026-11-05"]);
      expect(await daysOf("2026-11-05", "2026-11-06")).toEqual(["2026-11-05", "2026-11-06"]);
      
      expect(await daysOf("2026-11-06T02:00:00+09:00", "2026-11-06T10:00:00+09:00")).toEqual(["2026-11-06"]);
      expect(await daysOf("2026-11-05T22:00:00-03:00", "2026-11-05T23:30:00-03:00")).toEqual(["2026-11-05"]);
      
      expect(await daysOf("2026-11-05T00:00:00-03:00", "2026-11-07T00:00:00-03:00")).toEqual(["2026-11-05", "2026-11-06"]);
      
      expect(await daysOf("2026-10-31")).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    } finally {
      await serviceClient().from("nodes").delete().eq("id", node.data.id);
    }
  }, 60_000);

  it("a chat turn over several nodes asks Google nothing in its own request, and the same reads anywhere else do", async () => {
    const service = serviceClient();
    const spots: Array<{ node: string; account: string; task: string }> = [];
    for (const name of ["Alpine", "Borealis", "Cascade"]) {
      const node = await owner!.client.from("nodes").insert({ owner_id: owner!.id, kind: "client", name }).select("id").single();
      if (node.error) throw new Error(node.error.message);
      const account = await insertAccount(`${name.toLowerCase()}@example.com`, "refresh-reader", node.data.id, owner!);
      const granted = await service.from("google_accounts").update({ scopes: [GMAIL_READ_SCOPE] }).eq("id", account);
      if (granted.error) throw new Error(granted.error.message);
      const task = await owner!.client.from("items").insert({ owner_id: owner!.id, node_id: node.data.id, type: "task", title: `Answer ${name}` }).select("id").single();
      if (task.error) throw new Error(task.error.message);
      const link = await owner!.client.from("mail_links").insert({ owner_id: owner!.id, account_id: account, message_id: "m1", item_id: task.data.id });
      if (link.error) throw new Error(link.error.message);
      spots.push({ node: node.data.id, account, task: task.data.id });
    }
    const withMail = (): ToolContext => ({ ...ownerContext(), mail: gmailMailSource(deps) });
    const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } };
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () =>
        step++ === 0
          ? {
              stream: simulateReadableStream({
                chunks: [
                  ...spots.flatMap((spot) => [
                    { type: "tool-call" as const, toolCallId: `overview-${spot.node}`, toolName: "get_overview", input: JSON.stringify({ node: spot.node }) },
                    { type: "tool-call" as const, toolCallId: `item-${spot.task}`, toolName: "get_item", input: JSON.stringify({ id: spot.task }) },
                  ]),
                  { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
                ],
              }),
            }
          : {
              stream: simulateReadableStream({
                chunks: [
                  { type: "text-start" as const, id: "said" },
                  { type: "text-delta" as const, id: "said", delta: "Read." },
                  { type: "text-end" as const, id: "said" },
                  { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
                ],
              }),
            },
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expireTokens();
      const requests: Cost[] = [];
      const message = await chatTurn({
        ctx: { ...withMail(), source: "chat" },
        model,
        messages: [{ id: "asked", role: "user", parts: [{ type: "text", text: "What is pending in each client?" }] }],
        request: async (run) => {
          const { cost, result } = await costOf(run);
          requests.push(cost);
          return result;
        },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].google + requests[0].token).toBe(0);
      
      const outputs = message.parts.flatMap((part) => (isToolUIPart(part) && part.state === "output-available" ? [part.output as { eventsToRead?: string[]; mailToRead?: string[] }] : []));
      expect(outputs).toHaveLength(spots.length * 2);
      expect(outputs.flatMap((output) => output.eventsToRead ?? []).sort()).toEqual(spots.map((spot) => spot.account).sort());
      expect(outputs.flatMap((output) => output.mailToRead ?? []).sort()).toEqual(spots.map((spot) => spot.account).sort());
      
      await expireTokens();
      const { cost } = await costOf(() => Promise.all(spots.flatMap((spot) => [callTool("get_overview", withMail(), { node: spot.node }), callTool("get_item", withMail(), { id: spot.task })])));
      expect(cost.google).toBeGreaterThanOrEqual(spots.length * 2);
      expect(cost.token).toBeGreaterThanOrEqual(spots.length);
    } finally {
      quiet.mockRestore();
      await service.from("google_accounts").delete().in("id", spots.map((spot) => spot.account));
      await service.from("nodes").delete().in("id", spots.map((spot) => spot.node));
    }
  }, 120_000);

  it("in the chat's own request the sample accounts are still read, and a connected one beside them is listed", async () => {
    const service = serviceClient();
    const node = await owner!.client.from("nodes").insert({ owner_id: owner!.id, kind: "client", name: "Samples" }).select("id").single();
    if (node.error) throw new Error(node.error.message);
    const connected = await insertAccount("connected@example.com", "refresh-reader", node.data.id, owner!);
    const sample = await service.from("google_accounts").insert({ owner_id: owner!.id, email: "sample@demo.example", is_demo: true }).select("id").single();
    if (sample.error) throw new Error(sample.error.message);
    try {
      expect((await service.from("node_accounts").insert({ node_id: node.data.id, account_id: sample.data.id })).error).toBeNull();
      const task = await owner!.client.from("items").insert({ owner_id: owner!.id, node_id: node.data.id, type: "task", title: "Answer the samples" }).select("id").single();
      if (task.error) throw new Error(task.error.message);
      const links = await owner!.client.from("mail_links").insert([connected, sample.data.id].map((account) => ({ owner_id: owner!.id, account_id: account, message_id: "m1", item_id: task.data.id })));
      if (links.error) throw new Error(links.error.message);
      const asked: string[] = [];
      const events: EventsSource = async ({ account }) => (asked.push(account.id), { events: [], failures: [] });
      const many: MailSource["many"] = async ({ account }) => (asked.push(account.id), { messages: [], failures: [] });
      const ctx = (source: ToolContext["source"]): ToolContext => ({ ...ownerContext(), source, events, mail: { many } as unknown as MailSource });
      const overview = (await callTool("get_overview", ctx("chat"), { node: node.data.id })) as unknown as { eventsToRead: string[] };
      expect(overview.eventsToRead).toEqual([connected]);
      expect(asked).toEqual([sample.data.id]);
      asked.length = 0;
      const item = (await callTool("get_item", ctx("chat"), { id: task.data.id })) as unknown as { mailToRead: string[] };
      expect(item.mailToRead).toEqual([connected]);
      expect(asked).toEqual([sample.data.id]);
      
      asked.length = 0;
      const detail = (await callTool("get_item", ctx("manual"), { id: task.data.id })) as unknown as { mailToRead: string[] };
      expect([...detail.mailToRead].sort()).toEqual([connected, sample.data.id].sort());
      expect(asked).toEqual([]);
    } finally {
      await service.from("google_accounts").delete().in("id", [connected, sample.data.id]);
      await service.from("nodes").delete().eq("id", node.data.id);
    }
  }, 60_000);

  it("an account out of reach is not found: from another place, a scoped access, and another person", async () => {
    await withReaders(1);
    const other = await owner!.client.from("nodes").insert({ owner_id: owner!.id, kind: "client", name: "Contoso" }).select("id").single();
    expect(other.error).toBeNull();
    calls.length = 0;
    const fromElsewhere = await callTool("browse_events", ownerContext(), { ...range, node: other.data!.id, account: readers[0] });
    expect(fromElsewhere).toMatchObject({ ok: false, code: "not_found" });
    const listed = await callTool("list_events", ownerContext(), { ...window, node: other.data!.id, account: readers[0] });
    expect(listed).toMatchObject({ ok: false, code: "not_found" });
    const scoped = await callTool("browse_events", { ...ownerContext(), db: serviceClient(), scopeNodeId: other.data!.id, source: "agent", agentLabel: "laptop" }, { ...range, account: readers[0] });
    expect(scoped).toMatchObject({ ok: false, code: "not_found" });
    const stranger = await createDisposableUser("google-cost-stranger");
    try {
      const foreign = await callTool("browse_events", readerContext(stranger), { ...range, account: readers[0] });
      expect(foreign).toMatchObject({ ok: false, code: "not_found" });
      const own = (await callTool("browse_events", readerContext(stranger), range)) as unknown as Read;
      expect(own.events).toEqual([]);
      expect(own.toRead).toEqual([]);
    } finally {
      await deleteDisposableUsers([stranger]);
    }
    expect(calls).toEqual([]);
    
    const reached = await callTool("browse_events", ownerContext(), { ...range, node: place, account: readers[0] });
    expect(reached).toMatchObject({ ok: true });
    expect(calls.length).toBeGreaterThan(0);
  }, 60_000);

  it("a revoked account says so and asks Google nothing; its twin, an active one, asks", async () => {
    await withReaders(1);
    const service = serviceClient();
    await service.from("google_accounts").update({ status: "revoked" }).eq("id", readers[0]);
    try {
      await expireTokens();
      const { cost, result } = await costOf(() => callTool("browse_events", ownerContext(), { ...range, account: readers[0] }));
      expect(cost.google + cost.token).toBe(0);
      expect((result as unknown as Read).failures.map((failure) => failure.reason)).toEqual(["access was revoked: connect the account again"]);
    } finally {
      await service.from("google_accounts").update({ status: "active" }).eq("id", readers[0]);
    }
    const { cost } = await costOf(() => callTool("browse_events", ownerContext(), { ...range, account: readers[0] }));
    expect(cost.google).toBeGreaterThan(0);
  });

  it("without a source no account is read and none is listed, and a named one out of reach is still not found", async () => {
    await withReaders(3);
    const ctx: ToolContext = { db: owner!.client, ownerId: owner!.id, source: "manual" };
    const answer = (await callTool("browse_events", ctx, range)) as unknown as Read;
    expect(answer).toMatchObject({ ok: true, toRead: [], failures: [] });
    expect(answer.events.filter((event) => event.origin === "google")).toEqual([]);
    expect(await callTool("browse_events", ctx, { ...range, account: "00000000-0000-4000-8000-000000000000" })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("a chat turn reads each account in a request of its own, and its own requests cost the same with 3 and with 10", async () => {
    async function turnIn(size: number) {
      const requests: Cost[] = [];
      const reads: Cost[] = [];
      await withReaders(size);
      await expireTokens();
      const message = await chatTurn({
        ctx: { ...ownerContext(), source: "chat" },
        model: simulatedModel(),
        messages: [{ id: "asked", role: "user", parts: [{ type: "text", text: "What's on my calendar this week?" }] }],
        
        request: async (run) => {
          const { cost, result } = await costOf(async () => {
            await readSession(owner!.client);
            await takeUsageFor(serviceClient(), { id: owner!.id, isAnonymous: false }, "chat_message");
            await loadHistory(owner!.client, null);
            return run();
          });
          requests.push(cost);
          return result;
        },
        read: async (run) => {
          const { cost, result } = await costOf(run);
          reads.push(cost);
          return result;
        },
      });
      return { requests, reads, said: message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ") };
    }
    const medium = await turnIn(3);
    const large = await turnIn(10);
    
    expect(medium.said).toMatch(/This week|Nothing is on the calendars/);
    expect(large.said).toMatch(/This week|Nothing is on the calendars/);
    for (const turn of [medium, large]) expect(turn.requests.map((cost) => cost.google + cost.token)).toEqual(turn.requests.map(() => 0));
    expect(large.requests.map((cost) => cost.total)).toEqual(medium.requests.map((cost) => cost.total));
    
    expect(medium.reads).toHaveLength(1 + 3);
    expect(large.reads).toHaveLength(1 + 10);
    expect(large.reads[0].google + large.reads[0].token).toBe(0);
    expect(large.reads.slice(1).every((cost) => cost.token === 1 && cost.google === 1)).toBe(true);
    
    expect(new Set([...medium.reads.slice(1), ...large.reads.slice(1)].map((cost) => cost.total)).size).toBe(1);
  }, 180_000);
});

describe("connecting an account", () => {
  it("stores the tokens encrypted, attaches it to the node, and fills its calendars", async () => {
    const connected = await connectAccount(deps, { ownerId: user!.id, nodeId: ids.project }, "code", "http://localhost/api/google/callback");
    expect(connected).toMatchObject({ email: "new.account@example.com", calendars: 2 });
    const service = serviceClient();
    const account = await service.from("google_accounts").select("refresh_token, scopes").eq("id", connected.accountId).single();
    expect(account.data!.refresh_token).not.toContain("refresh-new");
    expect(await decrypt(deps.key, account.data!.refresh_token!)).toBe("refresh-new");
    const link = await service.from("node_accounts").select("node_id").eq("account_id", connected.accountId);
    expect(link.data).toEqual([{ node_id: ids.project }]);
    const calendars = await service.from("account_calendars").select("calendar_id, selected").eq("account_id", connected.accountId).order("calendar_id");
    expect(calendars.data).toEqual([
      { calendar_id: "holidays", selected: false },
      { calendar_id: "primary-cal", selected: true },
    ]);
  });

  it("connecting it again keeps the person's calendar choice and adds the new node", async () => {
    const service = serviceClient();
    const first = await service.from("google_accounts").select("id").eq("email", "new.account@example.com").eq("owner_id", user!.id).single();
    await service.from("account_calendars").update({ selected: true }).eq("account_id", first.data!.id).eq("calendar_id", "holidays");
    const again = await connectAccount(deps, { ownerId: user!.id, nodeId: ids.leaf }, "code", "http://localhost/api/google/callback");
    expect(again.accountId).toBe(first.data!.id);
    const holidays = await service.from("account_calendars").select("selected").eq("account_id", again.accountId).eq("calendar_id", "holidays").single();
    expect(holidays.data!.selected).toBe(true);
    const links = await service.from("node_accounts").select("node_id").eq("account_id", again.accountId);
    expect(new Set(links.data!.map((l) => l.node_id))).toEqual(new Set([ids.project, ids.leaf]));
  });
});

describe("writing to Google", () => {
  const ctx = () => ({ db: user!.client, ownerId: user!.id, source: "manual" as const, events: googleEventsSource(deps), calendar: googleCalendarWriter(deps) });

  it("creating, changing, and deleting an event is reflected in Google and read back", async () => {
    const created = (await callTool("create_google_event", ctx(), { account: ids.agency, calendar: "primary", title: "Client call", startsAt: "2026-11-04T15:00:00Z" })) as {
      ok: boolean;
      event: { id: string; start: string; end: string; allDay: boolean };
    };
    expect(created.ok).toBe(true);
    expect(created.event).toMatchObject({ start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T16:00:00.000Z", allDay: false });
    const read = await eventsOf(ids.root);
    expect(read.events.map((e) => e.title)).toContain("Client call");

    const moved = (await callTool("update_google_event", ctx(), { account: ids.agency, calendar: "primary", event: created.event.id, title: "Client call (moved)", startsOn: "2026-11-05", endsOn: "2026-11-06" })) as {
      ok: boolean;
      event: { title: string; allDay: boolean; start: string; end: string };
    };
    expect(moved.event).toMatchObject({ title: "Client call (moved)", allDay: true, start: "2026-11-05", end: "2026-11-06" });
    const stored = (googleEvents["token-agency"] as Array<{ id: string; end: { date: string } }>).find((e) => e.id === created.event.id);
    
    expect(stored?.end).toEqual({ date: "2026-11-07" });

    const removed = await callTool("delete_google_event", ctx(), { account: ids.agency, calendar: "primary", event: created.event.id });
    expect(removed.ok).toBe(true);
    expect((googleEvents["token-agency"] as Array<{ id: string }>).some((e) => e.id === created.event.id)).toBe(false);
    const missing = await callTool("delete_google_event", ctx(), { account: ids.agency, calendar: "primary", event: created.event.id });
    expect(missing).toMatchObject({ ok: false, code: "not_found" });
  });

  it("a revoked account, another owner's account, and a scoped access outside its accounts are refused", async () => {
    const revoked = await callTool("create_google_event", ctx(), { account: ids.revoked, calendar: "primary", title: "x", startsOn: "2026-11-04" });
    expect(revoked).toMatchObject({ ok: false });
    const other = await createDisposableUser("google-writer");
    try {
      const foreign = await callTool("create_google_event", { db: other.client, ownerId: other.id, source: "manual", calendar: googleCalendarWriter(deps) }, { account: ids.agency, calendar: "primary", title: "x", startsOn: "2026-11-04" });
      expect(foreign).toMatchObject({ ok: false, code: "not_found" });
    } finally {
      await deleteDisposableUsers([other]);
    }
    
    const scoped = await callTool("create_google_event", { ...ctx(), db: serviceClient(), scopeNodeId: ids.root, source: "agent", agentLabel: "laptop" }, { account: ids.landing, calendar: "primary", title: "x", startsOn: "2026-11-04" });
    expect(scoped).toMatchObject({ ok: false, code: "not_found" });
    const notConfigured = await callTool("create_google_event", { db: user!.client, ownerId: user!.id, source: "manual" }, { account: ids.agency, calendar: "primary", title: "x", startsOn: "2026-11-04" });
    expect(notConfigured).toMatchObject({ ok: false, code: "not_found" });
  });

  it("connecting refuses an authorization without the events or the calendar list permission", async () => {
    grantedScope = "openid https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly";
    try {
      await expect(connectAccount(deps, { ownerId: user!.id, nodeId: ids.project }, "code", "http://localhost/api/google/callback")).rejects.toThrow(/calendar access/);
    } finally {
      grantedScope = FULL_GRANT;
    }
  });

  it("connecting refuses an authorization without the Gmail permission", async () => {
    
    
    grantedScope = "openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
    try {
      await expect(connectAccount(deps, { ownerId: user!.id, nodeId: ids.project }, "code", "http://localhost/api/google/callback")).rejects.toThrow(/mail access/);
    } finally {
      grantedScope = FULL_GRANT;
    }
  });

  it("the authorization asks exactly for the events, the calendar list and reading mail, besides identity", async () => {
    const { authorizationUrl } = await import("@/lib/google/connect");
    const scope = new URL(authorizationUrl("id", "http://localhost/cb", "state")).searchParams.get("scope");
    expect(scope?.split(" ").sort()).toEqual([
      "email",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.readonly",
      "openid",
    ]);
  });
});
