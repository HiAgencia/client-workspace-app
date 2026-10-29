import { validateUIMessages } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadHistory } from "@/lib/chat/history";
import { demoGeneral, demoSeedTree, settleDemoTokens, type SeedAccount, type SeedChat, type SeedEvent, type SeedItem, type SeedToken } from "@/lib/demo-seed";
import { sanitizeMailHtml } from "@/lib/mail/sanitize";
import { inlineLink } from "@/lib/inline-links";
import { firstLine, noteTitle } from "@/lib/rich-text";
import { sanitizeRichText } from "@/lib/rich-text";
import { isWorkingTime, workingMinutesBetween } from "@/lib/working-time";
import { createAnonymousUser, deleteDisposableUsers, publicClient, serviceClient, type Db, type DisposableUser } from "../support/supabase";

// The demo seed is one database call; this test keeps its result identical to the TypeScript tree and its general work,
// its moments in the visitor's working time, its manual order, its linked event, its tokens and its conversations as the
// mirror declares them, and keeps a second call from planting anything.

const TODAY = "2026-10-27";
const ZONE = "America/Argentina/Buenos_Aires";
// The database's clock and this machine's differ by the round trip; a moment within these working minutes is on time.
const TOLERANCE = 2;
type Tree = ReturnType<typeof demoSeedTree>;
type ExpectedNode = { path: string; kind: string; position: number; color: string | null };
// What lives in no node reads under this place.
const GENERAL = "General";
type ExpectedItem = {
  path: string;
  parent: string | null;
  type: string;
  title: string;
  body: string | null;
  priority: number | null;
  dueOn: string | null;
  dueTime: string | null;
  status: string;
  source: string;
  agentLabel: string | null;
};

// A root carries its own kind; below a client every node is a project, below a project a subproject.
function expectedNodes(): ExpectedNode[] {
  const rows: ExpectedNode[] = [];
  const walk = (nodes: Tree, parent: string, parentKind: string | null) => {
    nodes.forEach((node, position) => {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      const kind = parentKind === null ? (node.kind ?? "client") : parentKind === "client" ? "project" : "subproject";
      rows.push({ path, kind, position, color: node.color ?? null });
      walk(node.children ?? [], path, kind);
    });
  };
  walk(demoSeedTree(TODAY), "", null);
  return rows;
}

function expectedItems(): ExpectedItem[] {
  const rows: ExpectedItem[] = [];
  const add = (path: string, item: SeedItem, parent: string | null) => {
    const { tool, input } = item;
    const row: ExpectedItem = {
      path,
      parent,
      type: "",
      title: "",
      body: null,
      priority: null,
      dueOn: null,
      dueTime: null,
      status: item.doneAgo === undefined ? "open" : "done",
      source: item.by?.source ?? "manual",
      agentLabel: item.by?.source === "agent" ? item.by.agentLabel : null,
    };
    if (tool === "create_task") {
      row.type = "task";
      row.title = String(input.title);
      row.body = input.notes ? String(input.notes) : null;
      row.priority = input.priority ? Number(input.priority) : 4;
      row.dueOn = input.dueOn ? String(input.dueOn) : null;
      row.dueTime = input.dueTime ? String(input.dueTime) : null;
    } else if (tool === "add_note") {
      row.type = "note";
      row.body = String(input.text);
      // A note's title keeps the links of its first line over their words.
      row.title = noteTitle(row.body);
    } else if (tool === "add_decision") {
      row.type = "decision";
      row.title = String(input.decision);
      row.body = input.rationale ? String(input.rationale) : null;
    } else if (tool === "request_review") {
      // A review an agent asks for is a task of the day it asked, with the address over its words.
      row.type = "task";
      row.title = input.url ? inlineLink(String(input.title), String(input.url)) : String(input.title);
      row.priority = 4;
      row.dueOn = TODAY;
    }
    rows.push(row);
    for (const child of item.children ?? []) add(path, child, row.title);
  };
  const walk = (nodes: Tree, parent: string) => {
    for (const node of nodes) {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      for (const item of node.items ?? []) add(path, item, null);
      walk(node.children ?? [], path);
    }
  };
  walk(demoSeedTree(TODAY), "");
  for (const item of demoGeneral(TODAY).items) add(GENERAL, item, null);
  return rows;
}

// Every item of the mirror, with its place: the nodes' and General's.
function everyItem(): SeedItem[] {
  const list: SeedItem[] = [];
  const collect = (items: SeedItem[]) => items.forEach((item) => (list.push(item), collect(item.children ?? [])));
  const walk = (nodes: Tree) => nodes.forEach((node) => (collect(node.items ?? []), walk(node.children ?? [])));
  walk(demoSeedTree(TODAY));
  collect(demoGeneral(TODAY).items);
  return list;
}

function titleOf(item: SeedItem): string {
  if (item.tool === "add_note") return noteTitle(String(item.input.text));
  if (item.tool === "request_review" && item.input.url) return inlineLink(String(item.input.title), String(item.input.url));
  return String(item.input.title ?? item.input.decision);
}

function expectedEvents(): Array<{ path: string; title: string; day: string; linkedTo: string[] }> {
  const rows: Array<{ path: string; title: string; day: string; linkedTo: string[] }> = [];
  const push = (path: string, event: SeedEvent) => rows.push({ path, title: event.title, day: event.day, linkedTo: event.linkedTo ?? [] });
  const walk = (nodes: Tree, parent: string) => {
    for (const node of nodes) {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      for (const event of node.events ?? []) push(path, event);
      walk(node.children ?? [], path);
    }
  };
  walk(demoSeedTree(TODAY), "");
  for (const event of demoGeneral(TODAY).events) push(GENERAL, event);
  return rows;
}

// The chat turns and tokens the tree declares, by the path of their node.
function expectedChats(): Array<{ path: string; title: string; chat: SeedChat }> {
  const rows: Array<{ path: string; title: string; chat: SeedChat }> = [];
  const collect = (path: string, list: SeedItem[]) => {
    for (const item of list) {
      if (item.chat) rows.push({ path, title: String(item.input.title), chat: item.chat });
      collect(path, item.children ?? []);
    }
  };
  const walk = (nodes: Tree, parent: string) => {
    for (const node of nodes) {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      collect(path, node.items ?? []);
      walk(node.children ?? [], path);
    }
  };
  walk(demoSeedTree(TODAY), "");
  return rows;
}

// The sample accounts the mirror declares, by the path of their node.
function expectedAccounts(): Array<{ path: string; account: SeedAccount }> {
  const rows: Array<{ path: string; account: SeedAccount }> = [];
  const walk = (nodes: Tree, parent: string) => {
    for (const node of nodes) {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      for (const account of node.accounts ?? []) rows.push({ path, account });
      walk(node.children ?? [], path);
    }
  };
  walk(demoSeedTree(TODAY), "");
  return rows;
}

function declaredTokens(): Array<{ path: string; token: SeedToken }> {
  const rows: Array<{ path: string; token: SeedToken }> = [];
  const walk = (nodes: Tree, parent: string) => {
    for (const node of nodes) {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      for (const token of node.tokens ?? []) rows.push({ path, token });
      walk(node.children ?? [], path);
    }
  };
  walk(demoSeedTree(TODAY), "");
  return rows;
}

function expectedTokens(): Array<{ path: string; label: string }> {
  return declaredTokens().map(({ path, token }) => ({ path, label: token.label }));
}

// Every moment the seed wrote is inside working time in the zone it was given, and each item sits the working minutes
// before now its tree entry says. The renamed item's `updated_at` is the database's own stamp of the rename (now), which
// the signed-in role cannot set.
async function expectWorkingMoments(db: Db, zone: string) {
  const now = Date.now();
  const nodes = await db.from("nodes").select("name, created_at, updated_at");
  const items = await db.from("items").select("id, title, created_at, updated_at, completed_at");
  const events = await db.from("events").select("title, created_at, updated_at");
  const messages = await db.from("chat_messages").select("created_at");
  const renamed = new Set((await db.from("revisions").select("item_id")).data?.map((row) => row.item_id));
  expect(nodes.data?.length && items.data?.length && events.data?.length && messages.data?.length).toBeTruthy();
  const stamps: Array<[string, string]> = [
    ...(nodes.data ?? []).flatMap((row): Array<[string, string]> => [[`node ${row.name}`, row.created_at], [`node ${row.name}`, row.updated_at]]),
    ...(events.data ?? []).flatMap((row): Array<[string, string]> => [[`event ${row.title}`, row.created_at], [`event ${row.title}`, row.updated_at]]),
    ...(messages.data ?? []).map((row): [string, string] => ["chat message", row.created_at]),
    ...(items.data ?? []).flatMap((row): Array<[string, string]> => [
      [row.title, row.created_at],
      ...(renamed.has(row.id) ? [] : [[row.title, row.updated_at] as [string, string]]),
      ...(row.completed_at ? [[row.title, row.completed_at] as [string, string]] : []),
    ]),
  ];
  for (const [what, stamp] of stamps) expect(isWorkingTime(stamp, zone), `${what} at ${stamp} in ${zone}`).toBe(true);

  const when = new Map(everyItem().map((item) => [titleOf(item), { ago: item.ago, doneAgo: item.doneAgo }]));
  for (const row of items.data ?? []) {
    const expected = when.get(row.title);
    expect(expected, row.title).toBeDefined();
    expect(Math.abs(workingMinutesBetween(row.created_at, now, zone) - expected!.ago), `${row.title} created`).toBeLessThanOrEqual(TOLERANCE);
    if (expected!.doneAgo === undefined) expect(row.completed_at).toBeNull();
    else expect(Math.abs(workingMinutesBetween(row.completed_at!, now, zone) - expected!.doneAgo), `${row.title} done`).toBeLessThanOrEqual(TOLERANCE);
  }
}

type NodeRow = { id: string; parent_id: string | null; kind: string; name: string; position: number; color: string | null };

function placeOf(nodeId: string | null, byId: Map<string, NodeRow>): string {
  return nodeId === null ? GENERAL : pathOf(byId.get(nodeId)!, byId);
}

function pathOf(row: NodeRow, byId: Map<string, NodeRow>): string {
  const names: string[] = [];
  let cursor: NodeRow | undefined = row;
  while (cursor) {
    names.unshift(cursor.name);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return names.join(" / ");
}

const key = (row: { path: string; title?: string; type?: string }) => `${row.path}|${row.type ?? ""}|${row.title ?? ""}`;

let user: DisposableUser | undefined;

beforeAll(async () => {
  user = await createAnonymousUser("demo-seed");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

describe("the demo seed", () => {
  it("plants the whole tree in one call and leaves the same workspace demoSeedTree describes", async () => {
    if (!user) throw new Error("the test user was not created");
    const first = await user.client.rpc("seed_demo", { p_today: TODAY, p_zone: ZONE });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    const nodes = await user.client.from("nodes").select("id, parent_id, kind, name, position, color");
    expect(nodes.error).toBeNull();
    const nodeRows = (nodes.data ?? []) as NodeRow[];
    const byId = new Map(nodeRows.map((row) => [row.id, row]));
    const actualNodes = nodeRows.map((row) => ({ path: pathOf(row, byId), kind: row.kind, position: row.position, color: row.color }));

    const items = await user.client
      .from("items")
      .select("id, node_id, parent_item_id, type, title, body, priority, due_on, due_time, position, status, source, agent_label, created_at, completed_at");
    expect(items.error).toBeNull();
    const titles = new Map((items.data ?? []).map((row) => [row.id, row.title]));
    const actualItems = (items.data ?? []).map((row) => ({
      path: placeOf(row.node_id, byId),
      parent: row.parent_item_id ? (titles.get(row.parent_item_id) ?? "?") : null,
      type: row.type,
      title: row.title,
      body: row.body,
      priority: row.priority,
      dueOn: row.due_on,
      dueTime: row.due_time === null ? null : row.due_time.slice(0, 5),
      status: row.status,
      source: row.source,
      agentLabel: row.agent_label,
    }));

    expect(actualNodes.sort((a, b) => a.path.localeCompare(b.path))).toEqual(expectedNodes().sort((a, b) => a.path.localeCompare(b.path)));
    expect(actualItems.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      expectedItems().sort((a, b) => key(a).localeCompare(key(b))),
    );
    expect(actualNodes).toHaveLength(expectedNodes().length);
    expect(actualItems).toHaveLength(expectedItems().length);
    // Every body is the closed list's HTML, as the tool layer would have written it.
    for (const row of actualItems) if (row.body) expect(sanitizeRichText(row.body)).toBe(row.body);
    // A note's link is rich text in its body, never the brackets the editor would show as they are; its title keeps them.
    const notes = actualItems.filter((row) => row.type === "note");
    expect(notes.filter((row) => /\[[^\]]+\]\(https?:/.test(row.body ?? ""))).toEqual([]);
    const linked = notes.filter((row) => (row.body ?? "").includes("<a href="));
    expect(linked.length).toBeGreaterThan(0);
    for (const row of linked) expect(row.title, row.title).toMatch(/^\[[^\]]+\]\(https:\/\/[^)]+\)$/);
    expect(firstLine(linked[0].body)).not.toContain("](");

    // The tasks without a date read in the order the mirror sets by hand.
    const undated = (items.data ?? [])
      .filter((row) => row.type === "task" && row.status === "open" && row.due_on === null && row.parent_item_id === null)
      .sort((x, y) => Number(x.position) - Number(y.position))
      .map((row) => row.title);
    const ranked = everyItem()
      .filter((item) => item.rank !== undefined)
      .sort((x, y) => x.rank! - y.rank!)
      .map(titleOf);
    expect(ranked.length).toBeGreaterThan(1);
    expect(undated).toEqual(ranked);

    // Each item was written the working minutes ago the tree says, in the visitor's zone, and a finished task was
    // completed when it says: the activity reads a week of working days in progress, not one instant or a night.
    await expectWorkingMoments(user.client, ZONE);

    // The coding agent that wrote items has its tokens, unusable and unrevoked, on the nodes the tree names.
    const tokens = await user.client.from("agent_tokens").select("node_id, label, revoked_at");
    expect(tokens.error).toBeNull();
    // A name a person writes starts with its capital: the tokens' labels and the agent's name on what it wrote.
    const labels = [...(tokens.data ?? []).map((row) => row.label), ...actualItems.flatMap((row) => (row.agentLabel ? [row.agentLabel] : []))];
    expect(labels.length).toBeGreaterThan(2);
    for (const label of labels) expect(label, label).toMatch(/^\p{Lu}/u);
    expect(
      (tokens.data ?? []).map((row) => ({ path: pathOf(byId.get(row.node_id)!, byId), label: row.label, revoked: row.revoked_at })).sort((x, y) => x.path.localeCompare(y.path)),
    ).toEqual(expectedTokens().map((row) => ({ ...row, revoked: null })).sort((x, y) => x.path.localeCompare(y.path)));

    // The server dates them once planted, as the demo's route does: issued and last used the working minutes ago the tree
    // says, so Settings tells the same story as the activity.
    expect(await settleDemoTokens(serviceClient(), user.id, ZONE)).toEqual({ settled: declaredTokens().length, failed: 0, reasons: [] });
    const dated = await user.client.from("agent_tokens").select("node_id, label, created_at, last_used_at");
    expect(dated.error).toBeNull();
    for (const row of dated.data ?? []) {
      const declared = declaredTokens().find((entry) => entry.path === pathOf(byId.get(row.node_id)!, byId) && entry.token.label === row.label)!;
      for (const [moment, ago] of [[row.created_at, declared.token.issued], [row.last_used_at!, declared.token.lastUsed]] as const) {
        expect(isWorkingTime(moment, ZONE), `${declared.path} token at ${moment}`).toBe(true);
        expect(Math.abs(workingMinutesBetween(moment, Date.now(), ZONE) - ago)).toBeLessThan(TOLERANCE);
      }
    }

    // Each item the chat wrote has the turn that wrote it, in its node's conversation or the workspace's own: the request a
    // minute before, then the create_task call whose output is that item, and the answer. The stored history passes the
    // AI SDK's own validation, so the panel and the model both read it.
    const chats = expectedChats();
    expect(chats).toHaveLength(3);
    const nodeIdByPath = new Map(nodeRows.map((row) => [pathOf(row, byId), row.id]));
    for (const { path, title, chat } of chats) {
      const history = await loadHistory(user.client, chat.workspace ? null : nodeIdByPath.get(path)!);
      expect(await validateUIMessages({ messages: history })).toHaveLength(2);
      const [ask, answer] = history;
      expect(ask.role).toBe("user");
      expect(ask.parts).toEqual([{ type: "text", text: chat.ask }]);
      expect(answer.role).toBe("assistant");
      const item = (items.data ?? []).find((row) => row.title === title)!;
      const call = answer.parts.find((part) => part.type === "tool-create_task") as
        | { state: string; input: { title: string }; output: { ok: boolean; item: { id: string; nodePath: string; source: string; createdAt: string } } }
        | undefined;
      expect(call?.state).toBe("output-available");
      expect(call?.input.title).toBe(title);
      expect(call?.output).toMatchObject({ ok: true, item: { id: item.id, nodePath: path, source: "chat" } });
      expect(Date.parse(call!.output.item.createdAt)).toBe(Date.parse(item.created_at));
      expect(answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual([chat.answer]);
    }
    const stored = await user.client.from("chat_messages").select("node_id, role, created_at").order("seq");
    expect(stored.data).toHaveLength(6);
    for (let index = 0; index < 6; index += 2) {
      const [ask, answer] = [stored.data![index], stored.data![index + 1]];
      expect([ask.role, answer.role, ask.node_id === answer.node_id]).toEqual(["user", "assistant", true]);
      expect(workingMinutesBetween(ask.created_at, answer.created_at, ZONE)).toBeCloseTo(1, 3);
    }

    const events = await user.client.from("events").select("id, node_id, title, all_day, starts_on, ends_on");
    const links = await user.client.from("node_events").select("node_id, event_id");
    expect(links.error).toBeNull();
    const actualEvents = (events.data ?? []).map((row) => ({
      path: placeOf(row.node_id, byId),
      title: row.title,
      day: row.starts_on!,
      linkedTo: (links.data ?? []).filter((link) => link.event_id === row.id).map((link) => placeOf(link.node_id, byId)),
    }));
    expect(actualEvents.sort((a, b) => a.title.localeCompare(b.title))).toEqual(expectedEvents().sort((a, b) => a.title.localeCompare(b.title)));
    expect(expectedEvents().some((event) => event.linkedTo.length > 0)).toBe(true);
    expect((events.data ?? []).every((row) => row.all_day && row.starts_on === row.ends_on)).toBe(true);

    // The item with a first title left that title as a version.
    const changed = (items.data ?? []).find((row) => row.title === "Present two logo directions")!;
    const versions = await user.client.from("revisions").select("snapshot").eq("item_id", changed.id);
    expect(versions.data?.map((row) => (row.snapshot as { title: string }).title)).toEqual(["Present logo directions"]);

    // The sample accounts on the nodes the mirror names, their messages, and what the tasks wait for.
    const accounts = await user.client.from("google_accounts").select("id, email, is_demo");
    const attached = await user.client.from("node_accounts").select("node_id, account_id");
    const emailOf = new Map((accounts.data ?? []).map((row) => [row.id, row.email]));
    expect((accounts.data ?? []).every((row) => row.is_demo)).toBe(true);
    expect((attached.data ?? []).map((row) => ({ path: placeOf(row.node_id, byId), email: emailOf.get(row.account_id) })).sort((x, y) => x.email!.localeCompare(y.email!))).toEqual(
      expectedAccounts().map(({ path, account }) => ({ path, email: account.email })).sort((x, y) => x.email.localeCompare(y.email)),
    );
    const mail = await user.client.from("demo_mail").select("account_id, from_name, from_email, subject, snippet, text_body, html, unread, important, received_at");
    expect(mail.error).toBeNull();
    const now = Date.now();
    const actualMail = (mail.data ?? []).map((row) => ({
      account: emailOf.get(row.account_id),
      from: { name: row.from_name, email: row.from_email },
      subject: row.subject,
      snippet: row.snippet,
      text: row.text_body,
      unread: row.unread,
      important: row.important,
    }));
    const declaredMail = expectedAccounts().flatMap(({ account }) =>
      account.mail.map((message) => ({
        account: account.email,
        from: message.from,
        subject: message.subject,
        snippet: message.snippet,
        text: message.text,
        unread: message.unread,
        important: message.important,
      })),
    );
    expect(actualMail.sort((x, y) => x.subject.localeCompare(y.subject))).toEqual(declaredMail.sort((x, y) => x.subject.localeCompare(y.subject)));
    expect(expectedAccounts().some(({ account }) => account.mail.length === 0)).toBe(true);
    expect(declaredMail.some((message) => message.important) && declaredMail.some((message) => message.unread)).toBe(true);
    for (const row of mail.data ?? []) {
      const declared = expectedAccounts().flatMap(({ account }) => account.mail).find((message) => message.subject === row.subject)!;
      expect(isWorkingTime(row.received_at, ZONE), row.subject).toBe(true);
      expect(Math.abs(workingMinutesBetween(row.received_at, now, ZONE) - declared.ago), row.subject).toBeLessThanOrEqual(TOLERANCE);
      // Every sample is plain design: the sanitizer takes nothing out of it.
      expect(sanitizeMailHtml(row.html).removed).toEqual({ elements: 0, handlers: 0, links: 0, styles: 0 });
    }
    const waits = await user.client.from("task_mail").select("item_id, account_id, expect_from, status");
    expect((waits.data ?? []).map((row) => ({
      title: (items.data ?? []).find((item) => item.id === row.item_id)!.title,
      account: emailOf.get(row.account_id!),
      from: row.expect_from,
      status: row.status,
    })).sort((x, y) => x.title.localeCompare(y.title))).toEqual(
      everyItem()
        .filter((item) => item.waitsFor)
        .map((item) => ({ title: titleOf(item), account: item.waitsFor!.account, from: item.waitsFor!.from, status: "waiting" }))
        .sort((x, y) => x.title.localeCompare(y.title)),
    );

    const second = await user.client.rpc("seed_demo", { p_today: TODAY });
    expect(second.error).toBeNull();
    expect(second.data).toBe(false);
    const after = await user.client.from("nodes").select("id", { count: "exact", head: true });
    expect(after.count).toBe(expectedNodes().length);
  });

  it("two calls at once plant one tree", async () => {
    const race = await createAnonymousUser("demo-seed-race");
    try {
      const [first, second] = await Promise.all([
        race.client.rpc("seed_demo", { p_today: TODAY }),
        race.client.rpc("seed_demo", { p_today: TODAY }),
      ]);
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect([first.data, second.data].sort()).toEqual([false, true]);
      const nodes = await race.client.from("nodes").select("id", { count: "exact", head: true });
      expect(nodes.count).toBe(expectedNodes().length);
    } finally {
      await deleteDisposableUsers([race]);
    }
  });

  it("cannot run without a session, and each owner sees only its own tree", async () => {
    if (!user) throw new Error("the test user was not created");
    await user.client.rpc("seed_demo", { p_today: TODAY });
    const other = await createAnonymousUser("demo-seed-other");
    try {
      const anonymous = await publicClient().rpc("seed_demo", { p_today: TODAY });
      expect(anonymous.error?.code).toBe("42501");
      // Without a zone the seed dates its moments in UTC working time.
      const seeded = await other.client.rpc("seed_demo", { p_today: TODAY });
      expect(seeded.error).toBeNull();
      expect(seeded.data).toBe(true);
      await expectWorkingMoments(other.client, "UTC");
      const theirMessages = await other.client.from("chat_messages").select("id");
      const mineMessages = await user.client.from("chat_messages").select("id");
      expect(theirMessages.data).toHaveLength(6);
      expect(mineMessages.data).toHaveLength(6);
      const mine = await user.client.from("nodes").select("id");
      const theirs = await other.client.from("nodes").select("id");
      expect(mine.data).toHaveLength(expectedNodes().length);
      expect(theirs.data).toHaveLength(expectedNodes().length);
      const mineIds = new Set((mine.data ?? []).map((node) => node.id));
      expect((theirs.data ?? []).every((node) => !mineIds.has(node.id))).toBe(true);
    } finally {
      await deleteDisposableUsers([other]);
    }
  });
});
