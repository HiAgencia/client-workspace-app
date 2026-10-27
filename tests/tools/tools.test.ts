import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolContext, EventsSource } from "@/lib/tools/context";
import { restoreItem } from "@/lib/tools/items";
import { changeNode } from "@/lib/tools/tree-writes";
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
  it("publishes the twelve tools, each described, with a read-only flag", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "add_decision",
        "add_link",
        "add_review",
        "create_task",
        "delete_item",
        "get_overview",
        "get_updates_since",
        "list_events",
        "list_items",
        "list_tree",
        "search_items",
        "update_item",
      ].sort(),
    );
    for (const tool of tools) expect(tool.description.length).toBeGreaterThan(40);
    expect(tools.filter((tool) => tool.readOnly).map((tool) => tool.name).sort()).toEqual(
      ["get_overview", "get_updates_since", "list_events", "list_items", "list_tree", "search_items"].sort(),
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
    expect(decision.item).toMatchObject({ type: "decision", title: "Use Workers", body: "One deploy target", priority: null });
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

async function node_(user: DisposableUser, name: string): Promise<string> {
  return node(user, "project", name, treeA.acme);
}
