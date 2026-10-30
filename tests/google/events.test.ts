import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Fetch } from "@/lib/google/api";
import { connectAccount } from "@/lib/google/connect";
import { decrypt, encrypt, importKey, newKeyBase64 } from "@/lib/google/crypto";
import { googleCalendarWriter, googleEventsSource, type GoogleDeps } from "@/lib/google/events";
import { callTool } from "@/lib/tools/registry";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// The Google side is simulated by a fetch that answers like Google; the database side is the real project. An
// "agency" account hangs from the client, a "landing" account from a subproject, and a revoked one from the project.

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
    // A token Google stopped accepting before its date.
    if (token === "token-dead") return json(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    const list = (googleEvents[token] ??= []) as Array<Record<string, unknown>>;
    const eventId = decodeURIComponent(url.pathname.split("/events/")[1] ?? "");
    const method = init?.method ?? "GET";
    // Google simulated: it keeps what is written per account, as the real calendar would.
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

async function insertAccount(email: string, refresh: string, node: string) {
  const service = serviceClient();
  const { data, error } = await service
    .from("google_accounts")
    .insert({
      owner_id: user!.id,
      email,
      refresh_token: await encrypt(deps.key, refresh),
      // An expired access token forces the renewal path.
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

describe("events from inherited accounts", () => {
  it("the subproject sees its own account and the inherited ones; a revoked one is reported, not fatal", async () => {
    const source = googleEventsSource(deps);
    const { events, failures } = await source({ db: user!.client, ownerId: user!.id, nodeId: ids.leaf, ...window });
    expect(events.map((e) => e.title)).toEqual(["Landing review", "Agency standup"]);
    expect(events.find((e) => e.id === "l1")).toMatchObject({ allDay: true, fromNodeId: ids.leaf, accountEmail: "landing@example.com" });
    expect(events.find((e) => e.id === "a1")).toMatchObject({ allDay: false, fromNodeId: ids.root });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ accountEmail: "revoked@example.com" });
    expect(failures[0].reason).toMatch(/revoked/);
  });

  it("the root sees only its own account", async () => {
    const { events, failures } = await googleEventsSource(deps)({ db: user!.client, ownerId: user!.id, nodeId: ids.root, ...window });
    expect(events.map((e) => e.accountEmail)).toEqual(["agency@example.com"]);
    expect(failures).toEqual([]);
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
      const { events, failures } = await googleEventsSource(deps)({ db: user!.client, ownerId: user!.id, nodeId: ids.leaf, ...window });
      expect(failures.map((failure) => failure.accountEmail)).toEqual(["revoked@example.com"]);
      expect(events.every((event) => event.accountId !== sample.id)).toBe(true);
      // Only the three real accounts were asked; the sample one stays as it was, not marked revoked.
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
    const browsed = (await callTool("browse_events", ctx, { node: ids.leaf, ...window, fromDay: "2026-11-01", toDay: "2026-11-07" })) as {
      ok: boolean;
      events: Array<{ id: string; linkedTaskIds: string[] }>;
    };
    expect(browsed.ok).toBe(true);
    expect(browsed.events.find((event) => event.id === "a1")?.linkedTaskIds).toEqual([task.item.id]);
    expect(browsed.events.find((event) => event.id === "l1")?.linkedTaskIds).toEqual([]);
    expect(browsed.events.flatMap((event) => event.linkedTaskIds)).not.toContain(other.item.id);
    // A deleted task is no longer in it.
    await callTool("delete_item", ctx, { id: task.item.id });
    const after = (await callTool("browse_events", ctx, { node: ids.leaf, ...window, fromDay: "2026-11-01", toDay: "2026-11-07" })) as { ok: boolean; events: Array<{ id: string; linkedTaskIds: string[] }> };
    expect(after.events.find((event) => event.id === "a1")?.linkedTaskIds).toEqual([]);
  });

  it("list_events serves them through the tool layer, and another owner's id is not found", async () => {
    const ctx = { db: user!.client, ownerId: user!.id, source: "manual" as const, events: googleEventsSource(deps) };
    const result = (await callTool("list_events", ctx, { node: "Acme / Web / Landing", ...window })) as {
      ok: boolean;
      events: Array<{ title: string }>;
    };
    expect(result.ok).toBe(true);
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
    // Under a client of their own, so the reads above keep their accounts: both stored tokens are valid by their date.
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
    const { events, failures } = await googleEventsSource(deps)({ db: user!.client, ownerId: user!.id, nodeId: node, ...window });
    expect(events.map((event) => event.title)).toEqual(["Late review"]);
    expect(failures).toEqual([{ accountId: accountIds[1], accountEmail: "revoked-late@example.com", reason: "access was revoked: connect the account again" }]);
    const { data } = await service.from("google_accounts").select("id, access_token, status").in("id", accountIds);
    const late = data!.find((row) => row.id === accountIds[0])!;
    expect(await decrypt(deps.key, late.access_token!)).toBe("token-late");
    expect(data!.find((row) => row.id === accountIds[1])!.status).toBe("revoked");
  });
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
    const read = await googleEventsSource(deps)({ db: user!.client, ownerId: user!.id, nodeId: ids.root, ...window });
    expect(read.events.map((e) => e.title)).toContain("Client call");

    const moved = (await callTool("update_google_event", ctx(), { account: ids.agency, calendar: "primary", event: created.event.id, title: "Client call (moved)", startsOn: "2026-11-05", endsOn: "2026-11-06" })) as {
      ok: boolean;
      event: { title: string; allDay: boolean; start: string; end: string };
    };
    expect(moved.event).toMatchObject({ title: "Client call (moved)", allDay: true, start: "2026-11-05", end: "2026-11-06" });
    const stored = (googleEvents["token-agency"] as Array<{ id: string; end: { date: string } }>).find((e) => e.id === created.event.id);
    // Google counts a whole day's end as the next day.
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
    // A token scoped to the root does not see the account that hangs from the subproject.
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
    // Google's consent screen lets each permission be unticked: the calendar alone does not connect an account whose
    // mail the product reads.
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
