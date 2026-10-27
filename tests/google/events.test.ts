import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Fetch } from "@/lib/google/api";
import { connectAccount } from "@/lib/google/connect";
import { decrypt, encrypt, importKey, newKeyBase64 } from "@/lib/google/crypto";
import { googleEventsSource, type GoogleDeps } from "@/lib/google/events";
import { callTool } from "@/lib/tools/registry";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// The Google side is simulated by a fetch that answers like Google; the database side is the real project. An
// "agency" account hangs from the client, a "landing" account from a subproject, and a revoked one from the project.

let user: DisposableUser | undefined;
let deps: GoogleDeps;
const ids = { root: "", project: "", leaf: "", agency: "", landing: "", revoked: "" };
const calls: string[] = [];

const googleEvents: Record<string, unknown[]> = {
  "token-agency": [
    { id: "a1", summary: "Agency standup", start: { dateTime: "2026-11-03T12:00:00Z" }, end: { dateTime: "2026-11-03T12:15:00Z" } },
    { id: "a2", summary: "Cancelled", status: "cancelled", start: { dateTime: "2026-11-03T13:00:00Z" }, end: { dateTime: "2026-11-03T14:00:00Z" } },
  ],
  "token-landing": [{ id: "l1", summary: "Landing review", start: { date: "2026-11-02" }, end: { date: "2026-11-03" } }],
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
      scope: "openid https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email",
    });
  }
  if (url.pathname === "/v1/userinfo") return json(200, { email: "New.Account@example.com", email_verified: true });
  if (url.pathname.endsWith("/calendarList")) {
    return json(200, { items: [{ id: "primary-cal", summary: "Main", primary: true, backgroundColor: "#3366ff" }, { id: "holidays", summary: "Holidays" }] });
  }
  if (url.pathname.includes("/events")) {
    const token = (init?.headers as Record<string, string>).Authorization.replace("Bearer ", "");
    return json(200, { items: googleEvents[token] ?? [] });
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
