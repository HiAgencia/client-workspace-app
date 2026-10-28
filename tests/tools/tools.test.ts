import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolContext, EventsSource } from "@/lib/tools/context";
import { listRevisions, listTrash, restoreItem, restoreRevision } from "@/lib/tools/items";
import { changeNode, createNode } from "@/lib/tools/tree-writes";
import { restoreEvent } from "@/lib/tools/local-events";
import { callTool, tools } from "@/lib/tools/registry";
import type { ToolError } from "@/lib/tools/result";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// Integration tests of the shared tool layer against the real Supabase project, with two disposable owners. A owns
// Acme → { Web → Landing, Mobile → Landing }, so "Landing" alone is ambiguous; B owns a tree A must never reach.

type Tree = { acme: string; web: string; webLanding: string; mobile: string; mobileLanding: string };

let a: DisposableUser | undefined;
let b: DisposableUser | undefined;
let treeA: Tree;
let bClient: string;
let bItem: string;

async function node(user: DisposableUser, kind: "client" | "project" | "subproject", name: string, parent?: string) {
  const { data, error } = await user.client
    .from("nodes")
    .insert({ owner_id: user.id, kind, name, parent_id: parent ?? null })
    .select("id")
    .single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  return data.id;
}

function userCtx(user: DisposableUser | undefined, extra: Partial<ToolContext> = {}): ToolContext {
  if (!user) throw new Error("the test user was not created");
  return { db: user.client, ownerId: user.id, source: "manual", ...extra };
}

// What the MCP server builds: the service client, scoped to a token's node, writing as an agent.
function agentCtx(scopeNodeId: string, extra: Partial<ToolContext> = {}): ToolContext {
  if (!a) throw new Error("user A was not created");
  return { db: serviceClient(), ownerId: a.id, scopeNodeId, source: "agent", agentLabel: "laptop", ...extra };
}

type Success = { ok: true } & Record<string, unknown>;

async function run<T = Success>(name: string, ctx: ToolContext, input: unknown): Promise<T> {
  const result = await callTool(name, ctx, input);
  if (!result.ok) throw new Error(`${name} failed: ${(result as ToolError).code} ${(result as ToolError).message}`);
  return result as T;
}

async function refuse(name: string, ctx: ToolContext, input: unknown): Promise<ToolError> {
  const result = await callTool(name, ctx, input);
  expect(result.ok).toBe(false);
  return result as ToolError;
}

type ItemOut = { id: string; nodeId: string; nodePath: string; type: string; title: string; status: string; source: string; agentLabel: string | null; priority: number | null; completedAt: string | null; deletedAt: string | null; body: string | null; url: string | null; dueOn: string | null; updatedAt: string };

beforeAll(async () => {
  a = await createDisposableUser("tools-a");
  b = await createDisposableUser("tools-b");
  const acme = await node(a, "client", "Acme");
  const web = await node(a, "project", "Web", acme);
  const webLanding = await node(a, "subproject", "Landing", web);
  const mobile = await node(a, "project", "Mobile", acme);
  const mobileLanding = await node(a, "subproject", "Landing", mobile);
  treeA = { acme, web, webLanding, mobile, mobileLanding };
  bClient = await node(b, "client", "Beta Diseño");
  const { data, error } = await b.client
    .from("items")
    .insert({ node_id: bClient, type: "task", title: "B secret task" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  bItem = data.id;
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([a, b]);
}, 60_000);

describe("the registry", () => {
  it("publishes every tool, each described, with a read-only flag", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "add_decision",
        "add_link",
        "add_note",
        "add_review",
        "browse_events",
        "browse_items",
        "create_event",
        "create_google_event",
        "create_task",
        "delete_event",
        "delete_google_event",
        "delete_item",
        "get_overview",
        "get_updates_since",
        "link_task_event",
        "list_events",
        "list_items",
        "list_tree",
        "search_items",
        "unlink_task_event",
        "update_event",
        "update_google_event",
        "update_item",
      ].sort(),
    );
    for (const tool of tools) expect(tool.description.length).toBeGreaterThan(40);
    expect(tools.filter((tool) => tool.readOnly).map((tool) => tool.name).sort()).toEqual(
      ["browse_events", "browse_items", "get_overview", "get_updates_since", "list_events", "list_items", "list_tree", "search_items"].sort(),
    );
  });

  it("answers an unknown tool and invalid input as data, never throwing", async () => {
    expect((await refuse("drop_tables", userCtx(a), {})).code).toBe("not_found");
    expect((await refuse("create_task", userCtx(a), { node: treeA.web, title: "x", priority: 7 })).code).toBe(
      "invalid_input",
    );
    expect((await refuse("create_task", userCtx(a), { node: treeA.web, title: "   " })).code).toBe("invalid_input");
  });
});

describe("nodes by id or readable path", () => {
  it("resolves a whole path ignoring case and accents, and a unique tail", async () => {
    const whole = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: "acme / WEB / landing", title: "T1" });
    expect(whole.item.nodeId).toBe(treeA.webLanding);
    expect(whole.item.nodePath).toBe("Acme / Web / Landing");
    const tail = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: "Mobile / Landing", title: "T2" });
    expect(tail.item.nodeId).toBe(treeA.mobileLanding);
  });

  it("an ambiguous path returns the candidates instead of picking one", async () => {
    const error = await refuse("create_task", userCtx(a), { node: "Landing", title: "Where?" });
    expect(error.code).toBe("ambiguous");
    expect(error.ambiguous).toBe(true);
    expect(new Set(error.candidates?.map((c) => c.id))).toEqual(new Set([treeA.webLanding, treeA.mobileLanding]));
  });

  it("another owner's node is not found, by id or by path, for the user and for the service client", async () => {
    expect((await refuse("create_task", userCtx(a), { node: bClient, title: "Forged" })).code).toBe("not_found");
    expect((await refuse("create_task", userCtx(a), { node: "Beta Diseno", title: "Forged" })).code).toBe("not_found");
    const service: ToolContext = { db: serviceClient(), ownerId: a!.id, source: "manual" };
    expect((await refuse("get_overview", service, { node: bClient })).code).toBe("not_found");
  });

  it("without a node and without a scope, a write asks which node", async () => {
    expect((await refuse("create_task", userCtx(a), { title: "Nowhere" })).code).toBe("node_required");
  });
});

describe("writes", () => {
  it("create_task stores the source and defaults", async () => {
    const { item } = await run<{ item: ItemOut }>("create_task", userCtx(a, { source: "chat" }), {
      node: treeA.web,
      title: "Ship the pricing page",
      notes: "Copy from the brief",
      dueOn: "2026-12-01",
    });
    expect(item).toMatchObject({ type: "task", status: "open", priority: 4, source: "chat", agentLabel: null });
    expect(item.dueOn).toBe("2026-12-01");
  });

  it("an agent write carries its label, and an agent without one is refused", async () => {
    const { item } = await run<{ item: ItemOut }>("create_task", agentCtx(treeA.web), { title: "From the repo" });
    expect(item).toMatchObject({ nodeId: treeA.web, source: "agent", agentLabel: "laptop" });
    expect((await refuse("create_task", agentCtx(treeA.web, { agentLabel: undefined }), { title: "x" })).code).toBe(
      "internal",
    );
  });

  it("add_decision, add_link, and add_review store their own shapes", async () => {
    const decision = await run<{ item: ItemOut }>("add_decision", userCtx(a), {
      node: treeA.web,
      decision: "Use Workers",
      rationale: "One deploy target",
    });
    expect(decision.item).toMatchObject({ type: "decision", title: "Use Workers", body: "<p>One deploy target</p>", priority: null });
    const link = await run<{ item: ItemOut }>("add_link", userCtx(a), { node: treeA.web, url: "https://example.com/spec" });
    expect(link.item).toMatchObject({ type: "link", title: "https://example.com/spec", url: "https://example.com/spec" });
    const review = await run<{ item: ItemOut }>("add_review", userCtx(a), { node: treeA.web, title: "Check the mockups" });
    expect(review.item).toMatchObject({ type: "review", status: "open", url: null });
  });

  it("a link must be http or https", async () => {
    expect((await refuse("add_link", userCtx(a), { node: treeA.web, url: "javascript:alert(1)" })).code).toBe(
      "invalid_input",
    );
    expect((await refuse("add_link", userCtx(a), { node: treeA.web, url: "ftp://example.com" })).code).toBe(
      "invalid_input",
    );
  });

  it("update_item completes, reopens, and returns what it replaced", async () => {
    const { item } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.web, title: "Draft", priority: 2 });
    const done = await run<{ item: ItemOut; previous: { status: string; priority: number } }>("update_item", userCtx(a), {
      id: item.id,
      status: "done",
      priority: 1,
    });
    expect(done.item.status).toBe("done");
    expect(done.item.completedAt).not.toBeNull();
    expect(done.previous).toMatchObject({ status: "open", priority: 2 });
    const reopened = await run<{ item: ItemOut }>("update_item", userCtx(a), { id: item.id, status: "open" });
    expect(reopened.item.completedAt).toBeNull();
  });

  it("update_item refuses a priority on a decision, an empty change, and another owner's item", async () => {
    const { item } = await run<{ item: ItemOut }>("add_decision", userCtx(a), { node: treeA.web, decision: "No priority" });
    expect((await refuse("update_item", userCtx(a), { id: item.id, priority: 1 })).code).toBe("invalid_input");
    expect((await refuse("update_item", userCtx(a), { id: item.id })).code).toBe("invalid_input");
    expect((await refuse("update_item", userCtx(a), { id: bItem, title: "Hijacked" })).code).toBe("not_found");
    const service: ToolContext = { db: serviceClient(), ownerId: a!.id, source: "manual" };
    expect((await refuse("update_item", service, { id: bItem, title: "Hijacked" })).code).toBe("not_found");
  });

  it("delete_item is logical and restoreItem undoes it", async () => {
    const { item } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobile, title: "Temporary" });
    const deleted = await run<{ item: ItemOut }>("delete_item", userCtx(a), { id: item.id });
    expect(deleted.item.deletedAt).not.toBeNull();
    const listed = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node: treeA.mobile });
    expect(listed.items.map((i) => i.id)).not.toContain(item.id);
    expect((await refuse("update_item", userCtx(a), { id: item.id, title: "Ghost" })).code).toBe("not_found");
    const restored = await restoreItem(userCtx(a), item.id);
    expect(restored.ok && restored.item.deletedAt).toBeNull();
    const again = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node: treeA.mobile });
    expect(again.items.map((i) => i.id)).toContain(item.id);
    expect((await refuse("delete_item", userCtx(a), { id: bItem })).code).toBe("not_found");
  });
});

describe("reads", () => {
  it("list_tree shows the reachable tree with open counts and nothing of another owner", async () => {
    const { nodes } = await run<{ nodes: Array<{ id: string; path: string; openTasks: number }> }>(
      "list_tree",
      userCtx(a),
      {},
    );
    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set(Object.values(treeA)));
    expect(nodes.find((n) => n.id === treeA.webLanding)?.path).toBe("Acme / Web / Landing");
    expect(nodes.find((n) => n.id === treeA.webLanding)?.openTasks).toBeGreaterThanOrEqual(1);
  });

  it("list_items filters by type and status and orders tasks by priority", async () => {
    const node = await node_(a!, "Ordering");
    await run("create_task", userCtx(a), { node, title: "Low", priority: 4 });
    await run("create_task", userCtx(a), { node, title: "Urgent", priority: 1 });
    const done = await run<{ item: ItemOut }>("create_task", userCtx(a), { node, title: "Finished", priority: 1 });
    await run("update_item", userCtx(a), { id: done.item.id, status: "done" });
    await run("add_decision", userCtx(a), { node, decision: "A decision" });
    const tasks = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node, type: "task" });
    expect(tasks.items.map((i) => i.title)).toEqual(["Urgent", "Low"]);
    const finished = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node, status: "done" });
    expect(finished.items.map((i) => i.title)).toEqual(["Finished"]);
    const all = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node, status: "all" });
    expect(all.items).toHaveLength(4);
  });

  it("search_items matches titles and notes, takes % literally, and never reaches another owner", async () => {
    await run("create_task", userCtx(a), { node: treeA.mobile, title: "Raise prices 50%", notes: "after the audit" });
    await run("create_task", userCtx(a), { node: treeA.mobile, title: "Archive 500 files" });
    const byNote = await run<{ items: ItemOut[] }>("search_items", userCtx(a), { query: "AUDIT" });
    expect(byNote.items.map((i) => i.title)).toContain("Raise prices 50%");
    const literal = await run<{ items: ItemOut[] }>("search_items", userCtx(a), { query: "50%" });
    expect(literal.items.map((i) => i.title)).toEqual(["Raise prices 50%"]);
    const foreign = await run<{ items: ItemOut[] }>("search_items", userCtx(a), { query: "secret" });
    expect(foreign.items).toEqual([]);
  });

  it("get_overview gathers a node's pending work and its events", async () => {
    const events: EventsSource = async ({ nodeId }) => ({
      events: [
        {
          id: "e1",
          title: "Kickoff",
          start: "2026-11-02T13:00:00Z",
          end: "2026-11-02T14:00:00Z",
          allDay: false,
          location: null,
          link: null,
          calendarId: "primary",
          calendarName: "Agency",
          color: null,
          accountId: "acc",
          accountEmail: "agency@example.com",
          fromNodeId: nodeId,
        },
      ],
      failures: [],
    });
    const overview = await run<{ openTasks: ItemOut[]; decisions: ItemOut[]; links: ItemOut[]; toReview: ItemOut[]; children: Array<{ id: string }>; events: Array<{ title: string }> }>(
      "get_overview",
      userCtx(a, { events }),
      { node: "Acme / Web" },
    );
    expect(overview.openTasks.length).toBeGreaterThan(0);
    expect(overview.openTasks.every((i) => i.type === "task" && i.status === "open")).toBe(true);
    expect(overview.decisions.length).toBeGreaterThan(0);
    expect(overview.links.length).toBeGreaterThan(0);
    expect(overview.toReview.length).toBeGreaterThan(0);
    expect(overview.children.map((c) => c.id)).toEqual([treeA.webLanding]);
    expect(overview.events.map((e) => e.title)).toEqual(["Kickoff"]);
  });

  it("list_events passes the window to the source, reports failing accounts, and refuses a reversed window", async () => {
    const events: EventsSource = async () => ({
      events: [],
      failures: [{ accountId: "acc", accountEmail: "broken@example.com", reason: "access revoked" }],
    });
    const listed = await run<{ failures: Array<{ reason: string }>; from: string; to: string }>(
      "list_events",
      userCtx(a, { events }),
      { node: treeA.web, from: "2026-11-01", to: "2026-11-08" },
    );
    expect(listed.failures[0].reason).toBe("access revoked");
    expect(listed.from).toBe("2026-11-01T00:00:00.000Z");
    expect(
      (await refuse("list_events", userCtx(a), { node: treeA.web, from: "2026-11-08", to: "2026-11-01" })).code,
    ).toBe("invalid_input");
  });

  it("get_updates_since sorts what happened into created, changed, completed, and deleted", async () => {
    const changed = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobileLanding, title: "Old" });
    const completed = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobileLanding, title: "To finish" });
    const deleted = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobileLanding, title: "To drop" });
    // The moment comes from the database's clock, not this machine's: the last write before it.
    const since = new Date(Date.parse(deleted.item.updatedAt) + 1).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const created = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobileLanding, title: "Fresh" });
    await run("update_item", userCtx(a), { id: changed.item.id, title: "Renamed" });
    await run("update_item", userCtx(a), { id: completed.item.id, status: "done" });
    await run("delete_item", userCtx(a), { id: deleted.item.id });
    const updates = await run<Record<"created" | "changed" | "completed" | "deleted", ItemOut[]>>(
      "get_updates_since",
      userCtx(a),
      { since, node: treeA.mobileLanding },
    );
    expect(updates.created.map((i) => i.id)).toEqual([created.item.id]);
    expect(updates.changed.map((i) => i.id)).toEqual([changed.item.id]);
    expect(updates.completed.map((i) => i.id)).toEqual([completed.item.id]);
    expect(updates.deleted.map((i) => i.id)).toEqual([deleted.item.id]);
  });

  it("get_updates_since takes the access's last use when no moment is given, and asks for one otherwise", async () => {
    expect((await refuse("get_updates_since", userCtx(a), {})).code).toBe("since_required");
    const updates = await run<{ since: string }>("get_updates_since", agentCtx(treeA.web, { updatesSince: "2020-01-01T00:00:00Z" }), {});
    // The stored mark is used as the database wrote it.
    expect(updates.since).toBe("2020-01-01T00:00:00Z");
  });
});

describe("archiving", () => {
  it("an archived node takes what hangs from it out of reach, and restoring brings it back", async () => {
    const ctx = userCtx(a);
    const project = await node_(a!, "Archived soon");
    const child = await node(a!, "subproject", "Below it", project);
    await run("create_task", ctx, { node: child, title: "Hidden with its parent" });
    const archived = await changeNode(ctx, project, { archived: true });
    expect(archived.ok).toBe(true);
    const { nodes } = await run<{ nodes: Array<{ id: string }> }>("list_tree", ctx, {});
    expect(nodes.map((n) => n.id)).not.toContain(child);
    expect((await refuse("create_task", ctx, { node: child, title: "x" })).code).toBe("not_found");
    expect((await refuse("create_task", ctx, { node: "Below it", title: "x" })).code).toBe("not_found");
    const found = await run<{ items: ItemOut[] }>("search_items", ctx, { query: "Hidden with its parent" });
    expect(found.items).toEqual([]);
    expect((await changeNode(ctx, project, { archived: false })).ok).toBe(true);
    const back = await run<{ nodes: Array<{ id: string; path: string }> }>("list_tree", ctx, {});
    expect(back.nodes.find((n) => n.id === child)?.path).toBe("Acme / Archived soon / Below it");
  });
});

describe("another owner's ids on the writes that have no tool", () => {
  it("restoring another owner's item and unarchiving another owner's node are not found, and change nothing", async () => {
    const service = serviceClient();
    await service.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", bItem);
    const restored = await restoreItem(userCtx(a), bItem);
    expect(restored).toMatchObject({ ok: false, code: "not_found" });
    const stillDeleted = await service.from("items").select("deleted_at").eq("id", bItem).single();
    expect(stillDeleted.data!.deleted_at).not.toBeNull();
    await service.from("items").update({ deleted_at: null }).eq("id", bItem);

    await service.from("nodes").update({ archived_at: new Date().toISOString() }).eq("id", bClient);
    const unarchived = await changeNode(userCtx(a), bClient, { archived: false });
    expect(unarchived).toMatchObject({ ok: false, code: "not_found" });
    const stillArchived = await service.from("nodes").select("archived_at").eq("id", bClient).single();
    expect(stillArchived.data!.archived_at).not.toBeNull();
    await service.from("nodes").update({ archived_at: null }).eq("id", bClient);
  });
});

describe("a scoped agent", () => {
  it("does not reach a sibling of its node, by id, by path, or through an item", async () => {
    const ctx = agentCtx(treeA.web);
    expect((await refuse("create_task", ctx, { node: treeA.mobile, title: "Escape" })).code).toBe("not_found");
    expect((await refuse("create_task", ctx, { node: "Acme / Mobile", title: "Escape" })).code).toBe("not_found");
    expect((await refuse("get_overview", ctx, { node: treeA.acme })).code).toBe("not_found");
    const sibling = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobile, title: "Sibling's" });
    expect((await refuse("update_item", ctx, { id: sibling.item.id, title: "Escape" })).code).toBe("not_found");
    expect((await refuse("delete_item", ctx, { id: sibling.item.id })).code).toBe("not_found");
    // The switch off: the same service client and owner without the scope reach that sibling, so the scope is what
    // refused it above, not the data.
    const unscoped = agentCtx(treeA.web, { scopeNodeId: undefined });
    const reached = await run<{ item: ItemOut }>("update_item", unscoped, { id: sibling.item.id, title: "Sibling's" });
    expect(reached.item.nodeId).toBe(treeA.mobile);
  });

  it("the owner filter is what keeps the service client off another owner's rows", async () => {
    const asA: ToolContext = { db: serviceClient(), ownerId: a!.id, source: "manual" };
    expect((await refuse("update_item", asA, { id: bItem, title: "Hijacked" })).code).toBe("not_found");
    // The switch off: the same service client with B as owner reaches B's item.
    const asB: ToolContext = { db: serviceClient(), ownerId: b!.id, source: "manual" };
    const reached = await run<{ item: ItemOut }>("update_item", asB, { id: bItem, title: "B secret task" });
    expect(reached.item.id).toBe(bItem);
  });

  it("sees only its subtree, and a path inside it is unambiguous", async () => {
    const ctx = agentCtx(treeA.web);
    const { nodes } = await run<{ nodes: Array<{ id: string }> }>("list_tree", ctx, {});
    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set([treeA.web, treeA.webLanding]));
    const { item } = await run<{ item: ItemOut }>("create_task", ctx, { node: "Landing", title: "Inside" });
    expect(item.nodeId).toBe(treeA.webLanding);
    const found = await run<{ items: ItemOut[] }>("search_items", ctx, { query: "Sibling's" });
    expect(found.items).toEqual([]);
  });
});

// The client with a counter of the tables each call reads: what a tool asks the database, counted where it asks.
function counting(db: ToolContext["db"]) {
  const reads = new Map<string, number>();
  const proxy = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "from") {
        return (table: string) => {
          reads.set(table, (reads.get(table) ?? 0) + 1);
          return target.from(table as never);
        };
      }
      return Reflect.get(target, key, receiver);
    },
  });
  return { db: proxy as ToolContext["db"], reads };
}

describe("one read of the tree per context", () => {
  it("a chat turn that reads the tree and then creates tasks does not read it again per task", async () => {
    const { db, reads } = counting(a!.client);
    const ctx: ToolContext = { db, ownerId: a!.id, source: "chat", scopeNodeId: treeA.web };
    await run("list_tree", ctx, {});
    await run("create_task", ctx, { title: "First of the turn" });
    await run("create_task", ctx, { node: "Landing", title: "Second of the turn" });
    expect(reads.get("nodes")).toBe(1);
    // The switch off: a fresh context per call reads the tree each time.
    const fresh = counting(a!.client);
    for (const title of ["Fresh one", "Fresh two"]) {
      await run("create_task", { db: fresh.db, ownerId: a!.id, source: "chat", scopeNodeId: treeA.web }, { title });
    }
    expect(fresh.reads.get("nodes")).toBe(2);
  });

  it("shaping the tree forgets the read, so the next tool sees the new node", async () => {
    const ctx = userCtx(a);
    await run("list_tree", ctx, {});
    const made = await createNode(ctx, { parent: treeA.acme, name: "Fresh project" });
    expect(made.ok).toBe(true);
    const { item } = await run<{ item: ItemOut }>("create_task", ctx, { node: "Acme / Fresh project", title: "In the new node" });
    expect(item.nodePath).toBe("Acme / Fresh project");
  });
});

describe("strict input", () => {
  it("a field the tool does not know is refused as data, not dropped", async () => {
    const parent = await refuse("create_task", userCtx(a), { node: treeA.web, title: "With a parent", assignee: "Ana" });
    expect(parent.code).toBe("invalid_input");
    expect(parent.message).toMatch(/assignee/);
    const item = await refuse("add_link", userCtx(a), { node: treeA.web, url: "https://example.com", item: "x" });
    expect(item.code).toBe("invalid_input");
    expect(item.message).toMatch(/item/);
    // Nothing was written by the refused calls.
    const listed = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node: treeA.web, status: "all" });
    expect(listed.items.some((i) => i.title === "With a parent")).toBe(false);
  });
});

describe("notes, subtasks, links, and branches", () => {
  it("a note is an item of its own: its first line is its title, it is listed by type, read and deleted by an agent", async () => {
    const { item: note } = await run<{ item: ItemOut }>("add_note", userCtx(a), {
      node: treeA.mobile,
      text: "<p>Kickoff with <strong>Acme</strong></p><ul><li>budget</li></ul><script>x()</script>",
    });
    expect(note.type).toBe("note");
    expect(note.title).toBe("Kickoff with Acme");
    expect(note.body).toBe("<p>Kickoff with <strong>Acme</strong></p><ul><li>budget</li></ul>");
    expect(note.status).toBe("open");
    const listed = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node: treeA.mobile, type: "note" });
    expect(listed.items.map((i) => i.id)).toEqual([note.id]);
    // A note has no status, priority, or date.
    expect((await refuse("update_item", userCtx(a), { id: note.id, status: "done" })).code).toBe("invalid_input");
    expect((await refuse("update_item", userCtx(a), { id: note.id, priority: 1 })).code).toBe("invalid_input");
    // Changing its text changes its title.
    const changed = await run<{ item: ItemOut }>("update_item", userCtx(a), { id: note.id, notes: "Second thoughts\nmore" });
    expect(changed.item.title).toBe("Second thoughts");
    expect(changed.item.body).toBe("<p>Second thoughts</p><p>more</p>");
    // The MCP reads it and deletes it.
    const agent = agentCtx(treeA.acme);
    const read = await run<{ items: ItemOut[] }>("list_items", agent, { node: treeA.mobile, type: "note" });
    expect(read.items.some((i) => i.id === note.id)).toBe(true);
    const gone = await run<{ item: ItemOut }>("delete_item", agent, { id: note.id });
    expect(gone.item.deletedAt).not.toBeNull();
  });

  it("a task keeps subtasks, notes, and links; deleting it takes the branch and undo brings the whole branch back", async () => {
    const { item: task } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobileLanding, title: "Parent task" });
    const { item: sub } = await run<{ item: ItemOut & { parentId: string } }>("create_task", userCtx(a), { parent: task.id, title: "Child" });
    const { item: grand } = await run<{ item: ItemOut & { parentId: string } }>("create_task", userCtx(a), { parent: sub.id, title: "Grandchild" });
    const { item: note } = await run<{ item: ItemOut & { parentId: string } }>("add_note", userCtx(a), { parent: task.id, text: "On the task" });
    const { item: link } = await run<{ item: ItemOut & { parentId: string } }>("add_link", userCtx(a), { parent: task.id, url: "https://example.com/a" });
    await run("add_link", userCtx(a), { parent: task.id, url: "https://example.com/b" });
    expect(sub.parentId).toBe(task.id);
    expect(sub.nodeId).toBe(treeA.mobileLanding);
    expect(note.parentId).toBe(task.id);
    expect(link.parentId).toBe(task.id);
    const children = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { parent: task.id, status: "all" });
    expect(children.items).toHaveLength(4);
    // A subtask under a note, or in another node than its parent, is refused.
    expect((await refuse("create_task", userCtx(a), { parent: note.id, title: "Under a note" })).code).toBe("invalid_input");
    expect((await refuse("create_task", userCtx(a), { parent: task.id, node: treeA.web, title: "Elsewhere" })).code).toBe("invalid_input");

    // A child deleted before on its own stays deleted when the branch comes back.
    const { item: early } = await run<{ item: ItemOut }>("create_task", userCtx(a), { parent: task.id, title: "Deleted before" });
    await run("delete_item", userCtx(a), { id: early.id });

    const deleted = await run<{ item: ItemOut; branch: number }>("delete_item", userCtx(a), { id: task.id });
    expect(deleted.branch).toBe(6);
    const after = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node: treeA.mobileLanding, status: "all" });
    expect(after.items.filter((i) => [task.id, sub.id, grand.id, note.id, link.id].includes(i.id))).toEqual([]);

    const restored = await restoreItem(userCtx(a), task.id);
    expect(restored.ok && restored.branch).toBe(6);
    const back = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node: treeA.mobileLanding, status: "all" });
    const ids = new Set(back.items.map((i) => i.id));
    for (const id of [task.id, sub.id, grand.id, note.id, link.id]) expect(ids.has(id)).toBe(true);
    expect(ids.has(early.id)).toBe(false);
  });

  it("the database refuses a parent that is not a live task of the same node, and a cycle", async () => {
    const { item: task } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.web, title: "Cycle root" });
    const { item: child } = await run<{ item: ItemOut }>("create_task", userCtx(a), { parent: task.id, title: "Cycle child" });
    const { item: decision } = await run<{ item: ItemOut }>("add_decision", userCtx(a), { node: treeA.web, decision: "Not a parent" });
    const cycle = await a!.client.from("items").update({ parent_item_id: child.id }).eq("id", task.id);
    expect(cycle.error?.code).toBe("23514");
    const underDecision = await a!.client.from("items").insert({ node_id: treeA.web, type: "task", title: "x", parent_item_id: decision.id });
    expect(underDecision.error?.code).toBe("23514");
    const otherNode = await a!.client.from("items").insert({ node_id: treeA.mobile, type: "task", title: "x", parent_item_id: task.id });
    expect(otherNode.error?.code).toBe("23514");
    const taskToNote = await a!.client.from("items").update({ type: "note", priority: null }).eq("id", task.id);
    expect(taskToNote.error?.code).toBe("23514");
  });

  it("a node's number is what is pending in its subtree, subtasks included", async () => {
    const { nodes: before } = await run<{ nodes: Array<{ id: string; openTasks: number; openReviews: number }> }>("list_tree", userCtx(a), {});
    const count = (nodes: typeof before, id: string) => nodes.find((n) => n.id === id)!;
    const { item: task } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.webLanding, title: "Counted" });
    await run("create_task", userCtx(a), { parent: task.id, title: "Counted child" });
    await run("add_review", userCtx(a), { node: treeA.webLanding, title: "Counted review" });
    const { nodes: after } = await run<{ nodes: typeof before }>("list_tree", userCtx(a), {});
    for (const id of [treeA.webLanding, treeA.web, treeA.acme]) {
      expect(count(after, id).openTasks - count(before, id).openTasks).toBe(2);
      expect(count(after, id).openReviews - count(before, id).openReviews).toBe(1);
    }
    expect(count(after, treeA.mobile).openTasks).toBe(count(before, treeA.mobile).openTasks);
    // The client sums its projects: its number equals the sum over its subtree's own items.
    const direct = await run<{ items: ItemOut[] }>("list_items", userCtx(a), { node: treeA.acme, includeSubprojects: true });
    const reviews = direct.items.filter((i) => i.type === "review").length;
    const tasks = direct.items.filter((i) => i.type === "task").length;
    expect(count(after, treeA.acme).openTasks).toBe(tasks);
    expect(count(after, treeA.acme).openReviews).toBe(reviews);
  });

  it("a client finds the links of its projects and their tasks", async () => {
    const { item: task } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.webLanding, title: "Task with a link" });
    const { item: link } = await run<{ item: ItemOut }>("add_link", userCtx(a), { parent: task.id, url: "https://example.com/deep", title: "Deep link" });
    const overview = await run<{ links: ItemOut[] }>("get_overview", userCtx(a), { node: treeA.acme });
    expect(overview.links.some((l) => l.id === link.id && l.nodePath === "Acme / Web / Landing")).toBe(true);
  });
});

describe("versions", () => {
  it("each change leaves the previous version with its author; restoring returns the exact state and leaves its own", async () => {
    const { item } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobile, title: "Versioned", priority: 2, notes: "<p>First</p>" });
    await run("update_item", { ...userCtx(a), source: "chat" }, { id: item.id, title: "Versioned v2", notes: "<p><strong>Second</strong></p>", priority: 1 });
    await run("update_item", agentCtx(treeA.acme), { id: item.id, status: "done" });
    const listed = await listRevisions(userCtx(a), item.id);
    if (!listed.ok) throw new Error(listed.message);
    expect(listed.revisions).toHaveLength(2);
    const [newest, oldest] = listed.revisions;
    expect(newest.source).toBe("agent");
    expect(newest.agentLabel).toBe("laptop");
    expect(newest.snapshot.status).toBe("open");
    expect(oldest.source).toBe("chat");
    expect(oldest.snapshot).toMatchObject({ title: "Versioned", body: "<p>First</p>", priority: 2, status: "open" });

    const restored = await restoreRevision(userCtx(a), oldest.id);
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.item).toMatchObject({ title: "Versioned", body: "<p>First</p>", priority: 2, status: "open", completedAt: null });
    const again = await listRevisions(userCtx(a), item.id);
    expect(again.ok && again.revisions).toHaveLength(3);
    // A change to nothing versioned leaves no version.
    await run("update_item", userCtx(a), { id: item.id, title: "Versioned" });
    const same = await listRevisions(userCtx(a), item.id);
    expect(same.ok && same.revisions).toHaveLength(3);
  });

  it("restoring a subtask deleted before its parent brings the parent back too: no live item under a deleted one", async () => {
    const { item: parent } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobile, title: "Orphan parent" });
    const { item: child } = await run<{ item: ItemOut }>("create_task", userCtx(a), { parent: parent.id, title: "Orphan child" });
    await run("delete_item", userCtx(a), { id: child.id });
    await run("delete_item", userCtx(a), { id: parent.id });
    const restored = await restoreItem(userCtx(a), child.id);
    expect(restored.ok).toBe(true);
    const rows = await a!.client.from("items").select("id, deleted_at").in("id", [parent.id, child.id]);
    expect(rows.data?.every((row) => row.deleted_at === null)).toBe(true);
  });

  it("restoring a version never moves the deletion of one item alone", async () => {
    const { item: parent } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobile, title: "Version parent" });
    const { item: child } = await run<{ item: ItemOut }>("create_task", userCtx(a), { parent: parent.id, title: "Version child" });
    await run("delete_item", userCtx(a), { id: parent.id });
    // The deletion left a version whose photo is the live parent; restoring it must not revive the parent without its child.
    const listed = await listRevisions(userCtx(a), parent.id);
    if (!listed.ok) throw new Error(listed.message);
    const live = listed.revisions.find((revision) => revision.snapshot.deleted_at === null)!;
    await restoreRevision(userCtx(a), live.id);
    const rows = await a!.client.from("items").select("id, deleted_at").in("id", [parent.id, child.id]);
    expect(rows.data?.every((row) => row.deleted_at !== null)).toBe(true);
  });

  it("the trash lists a deleted branch once, by its top item", async () => {
    const { item: task } = await run<{ item: ItemOut }>("create_task", userCtx(a), { node: treeA.mobile, title: "Trash parent" });
    await run("create_task", userCtx(a), { parent: task.id, title: "Trash child" });
    await run("delete_item", userCtx(a), { id: task.id });
    const trash = await listTrash(userCtx(a));
    if (!trash.ok) throw new Error(trash.message);
    const entry = trash.items.find((i) => i.id === task.id);
    expect(entry?.branch).toBe(2);
    expect(trash.items.some((i) => i.title === "Trash child")).toBe(false);
  });
});

describe("browsing", () => {
  type Browse = { items: ItemOut[]; total: number; counts: { type: Record<string, number>; priority: Record<string, number>; source: Record<string, number>; date: { overdue: number; dated: number; undated: number } } };

  it("filters by node and subtree, type, priority, origin, text, and due range, each filter with its count", async () => {
    const c: DisposableUser = await createDisposableUser("browse");
    try {
      const client = await node(c, "client", "Browse Co");
      const project = await node(c, "project", "Site", client);
      const ctx: ToolContext = { db: c.client, ownerId: c.id, source: "manual" };
      await run("create_task", ctx, { node: project, title: "Late one", priority: 1, dueOn: "2026-10-20" });
      await run("create_task", ctx, { node: project, title: "Due today", priority: 2, dueOn: "2026-10-28" });
      await run("create_task", ctx, { node: project, title: "Next week", priority: 3, dueOn: "2026-11-04" });
      await run("create_task", ctx, { node: project, title: "No date at all", priority: 1 });
      await run("create_task", { ...ctx, source: "chat" }, { node: client, title: "From the chat", dueOn: "2026-10-28" });
      await run("add_note", ctx, { node: project, text: "A note about the brief" });

      const today = await run<Browse>("browse_items", ctx, { to: "2026-10-28", today: "2026-10-28", sort: "due" });
      expect(today.items.map((i) => i.title)).toEqual(["Late one", "Due today", "From the chat"]);
      expect(today.counts.date.overdue).toBe(1);
      // An undated task never falls in a range: it is only in the unfiltered view.
      expect(today.items.some((i) => i.title === "No date at all")).toBe(false);
      const undated = await run<Browse>("browse_items", ctx, { undated: true, type: ["task"] });
      expect(undated.items.map((i) => i.title)).toEqual(["No date at all"]);

      const week = await run<Browse>("browse_items", ctx, { from: "2026-11-02", to: "2026-11-08" });
      expect(week.items.map((i) => i.title)).toEqual(["Next week"]);

      const all = await run<Browse>("browse_items", ctx, {});
      expect(all.total).toBe(6);
      expect(all.counts.type).toMatchObject({ task: 5, note: 1 });
      expect(all.counts.priority["1"]).toBe(2);
      expect(all.counts.source).toMatchObject({ manual: 5, chat: 1 });
      expect(all.counts.date).toMatchObject({ dated: 4, undated: 2 });

      // A facet's counts leave its own filter out: choosing Urgent still says how many each other priority has.
      const urgent = await run<Browse>("browse_items", ctx, { priority: [1] });
      expect(urgent.items.map((i) => i.title).sort()).toEqual(["Late one", "No date at all"]);
      expect(urgent.counts.priority).toMatchObject({ "1": 2, "2": 1, "3": 1, "4": 1 });
      expect(urgent.counts.type.task).toBe(2);

      const chat = await run<Browse>("browse_items", ctx, { source: ["chat"] });
      expect(chat.items.map((i) => i.title)).toEqual(["From the chat"]);
      const text = await run<Browse>("browse_items", ctx, { text: "BRIEF" });
      expect(text.items.map((i) => i.type)).toEqual(["note"]);
      const onlyProject = await run<Browse>("browse_items", ctx, { node: project, subtree: false });
      expect(onlyProject.items.some((i) => i.title === "From the chat")).toBe(false);
      const fromClient = await run<Browse>("browse_items", ctx, { node: client });
      expect(fromClient.total).toBe(6);
      expect((await refuse("browse_items", ctx, { undated: true, from: "2026-10-01" })).code).toBe("invalid_input");
    } finally {
      await deleteDisposableUsers([c]);
    }
  });
});

describe("events of the workspace's own", () => {
  it("an event is created, edited with its version, deleted and restored; a task lives in it and both see each other", async () => {
    const ctx = userCtx(a);
    const { event } = await run<{ event: { id: string; allDay: boolean; startsOn: string; endsOn: string } }>("create_event", ctx, {
      node: treeA.web,
      title: "Launch review",
      startsOn: "2026-11-03",
    });
    expect(event).toMatchObject({ allDay: true, startsOn: "2026-11-03", endsOn: "2026-11-03" });
    const moved = await run<{ event: { startsAt: string; allDay: boolean }; previous: { startsOn: string } }>("update_event", ctx, {
      id: event.id,
      startsAt: "2026-11-03T15:00:00Z",
    });
    expect(moved.event.allDay).toBe(false);
    expect(moved.previous.startsOn).toBe("2026-11-03");
    const versions = await a!.client.from("revisions").select("snapshot, source").eq("event_id", event.id);
    expect(versions.data).toHaveLength(1);
    expect((versions.data![0].snapshot as { starts_on: string }).starts_on).toBe("2026-11-03");

    const { item: task } = await run<{ item: ItemOut }>("create_task", ctx, { node: treeA.web, title: "Prepare the deck" });
    await run("link_task_event", ctx, { task: task.id, event: event.id });
    const events = await run<{ events: Array<{ origin: string; localId: string | null; title: string }> }>("browse_events", ctx, {
      node: treeA.acme,
      from: "2026-11-01T00:00:00Z",
      to: "2026-11-08T00:00:00Z",
      fromDay: "2026-11-01",
      toDay: "2026-11-07",
    });
    expect(events.events.filter((e) => e.origin === "local").map((e) => e.localId)).toContain(event.id);
    const links = await a!.client.from("item_events").select("item_id, event_id").eq("event_id", event.id);
    expect(links.data).toEqual([{ item_id: task.id, event_id: event.id }]);
    // A decision does not live in an event.
    const { item: decision } = await run<{ item: ItemOut }>("add_decision", ctx, { node: treeA.web, decision: "Not in an event" });
    expect((await refuse("link_task_event", ctx, { task: decision.id, event: event.id })).code).toBe("invalid_input");
    const unlinked = await run<{ removed: boolean }>("unlink_task_event", ctx, { task: task.id });
    expect(unlinked.removed).toBe(true);

    await run("delete_event", ctx, { id: event.id });
    const gone = await run<{ events: Array<{ localId: string | null }> }>("browse_events", ctx, { from: "2026-11-01T00:00:00Z", to: "2026-11-08T00:00:00Z", fromDay: "2026-11-01", toDay: "2026-11-07" });
    expect(gone.events.some((e) => e.localId === event.id)).toBe(false);
    const back = await restoreEvent(ctx, event.id);
    expect(back.ok && back.event.deletedAt).toBeNull();
  });
});

async function node_(user: DisposableUser, name: string): Promise<string> {
  return node(user, "project", name, treeA.acme);
}
