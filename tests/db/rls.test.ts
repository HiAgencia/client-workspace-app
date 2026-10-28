import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDisposableUser,
  deleteDisposableUsers,
  publicClient,
  serviceClient,
  type Db,
  type DisposableUser,
} from "../support/supabase";

// Integration test against the real Supabase project: two disposable users, A and B. A tries every command on what
// belongs to B and must be refused or see nothing; the tree functions return what the schema promises.

type Tree = { root: string; project: string; subproject: string; item: string; account: string; leafAccount: string };

let a: DisposableUser | undefined;
let b: DisposableUser | undefined;
let treeA: Tree;
let treeB: Tree;

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = result.data;
  if (result.error || data === null || data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? "no data"}`);
  }
  return data;
}

async function insertNode(db: Db, owner: string, kind: "client" | "project" | "subproject", name: string, parent?: string) {
  const row = must(
    await db.from("nodes").insert({ owner_id: owner, kind, name, parent_id: parent ?? null }).select("id").single(),
    `insert ${kind} ${name}`,
  );
  return row.id;
}

async function buildTree(user: DisposableUser, prefix: string): Promise<Tree> {
  const admin = serviceClient();
  const root = await insertNode(user.client, user.id, "client", `${prefix} Client`);
  const project = await insertNode(user.client, user.id, "project", `${prefix} Web`, root);
  const subproject = await insertNode(user.client, user.id, "subproject", `${prefix} Landing`, project);
  const item = must(
    await user.client
      .from("items")
      .insert({ node_id: subproject, type: "task", title: `${prefix} first task`, priority: 2 })
      .select("id")
      .single(),
    "insert item",
  ).id;
  // Accounts are written by the server, which holds the tokens.
  const account = must(
    await admin
      .from("google_accounts")
      .insert({ owner_id: user.id, email: `${prefix.toLowerCase()}-agency@example.com`, refresh_token: "cipher" })
      .select("id")
      .single(),
    "insert account",
  ).id;
  const leafAccount = must(
    await admin
      .from("google_accounts")
      .insert({ owner_id: user.id, email: `${prefix.toLowerCase()}-landing@example.com`, refresh_token: "cipher" })
      .select("id")
      .single(),
    "insert leaf account",
  ).id;
  must(await user.client.from("node_accounts").insert({ node_id: root, account_id: account }).select(), "attach root");
  must(
    await user.client.from("node_accounts").insert({ node_id: subproject, account_id: leafAccount }).select(),
    "attach leaf",
  );
  return { root, project, subproject, item, account, leafAccount };
}

beforeAll(async () => {
  a = await createDisposableUser("rls-a");
  b = await createDisposableUser("rls-b");
  treeA = await buildTree(a, "A");
  treeB = await buildTree(b, "B");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([a, b]);
}, 60_000);

function userA(): Db {
  if (!a) throw new Error("user A was not created");
  return a.client;
}

describe("nodes", () => {
  it("A does not read B's nodes", async () => {
    const { data, error } = await userA().from("nodes").select("id").in("id", [treeB.root, treeB.project]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot insert a node owned by B", async () => {
    const { error } = await userA().from("nodes").insert({ owner_id: b!.id, kind: "client", name: "Forged" });
    expect(error?.code).toBe("42501");
  });

  it("A cannot hang a node of its own under B's node", async () => {
    const { error } = await userA()
      .from("nodes")
      .insert({ owner_id: a!.id, kind: "project", name: "Intruder", parent_id: treeB.root });
    // The parent is invisible to A, so the tree rule refuses it as a missing parent.
    expect(error?.code).toBe("23503");
  });

  it("A cannot rename or delete B's node", async () => {
    const renamed = await userA().from("nodes").update({ name: "Hijacked" }).eq("id", treeB.root).select("id");
    expect(renamed.error).toBeNull();
    expect(renamed.data).toEqual([]);
    const deleted = await userA().from("nodes").delete().eq("id", treeB.root).select("id");
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual([]);
    const still = must(await serviceClient().from("nodes").select("name").eq("id", treeB.root).single(), "read B");
    expect(still.name).toBe("B Client");
  });

  it("the tree rules hold: a root is a client or a project, a client's child is a project, no move under its own subtree", async () => {
    // A project of one's own stands at the root, and takes subprojects below it.
    const rootProject = await userA().from("nodes").insert({ owner_id: a!.id, kind: "project", name: "Own project" }).select("id").single();
    expect(rootProject.error).toBeNull();
    const below = await userA()
      .from("nodes")
      .insert({ owner_id: a!.id, kind: "subproject", name: "Below own", parent_id: rootProject.data!.id })
      .select("id")
      .single();
    expect(below.error).toBeNull();
    const rootSubproject = await userA().from("nodes").insert({ owner_id: a!.id, kind: "subproject", name: "Loose" });
    expect(rootSubproject.error?.code).toBe("23514");
    const nestedClient = await userA()
      .from("nodes")
      .insert({ owner_id: a!.id, kind: "client", name: "Nested", parent_id: rootProject.data!.id });
    expect(nestedClient.error?.code).toBe("23514");
    const wrongChild = await userA()
      .from("nodes")
      .insert({ owner_id: a!.id, kind: "subproject", name: "Wrong", parent_id: treeA.root });
    expect(wrongChild.error?.code).toBe("23514");
    // A node keeps its kind: flipping a root project that holds a subproject to a client would leave a subproject under
    // a client.
    const flipped = await userA().from("nodes").update({ kind: "client" }).eq("id", rootProject.data!.id);
    expect(flipped.error?.code).toBe("23514");
    expect(flipped.error?.message).toContain("keeps its kind");
    const demoted = await userA().from("nodes").update({ parent_id: treeA.subproject, kind: "subproject" }).eq("id", treeA.project);
    expect(demoted.error?.code).toBe("23514");
    const renamed = await userA().from("nodes").update({ name: "Own project, renamed" }).eq("id", rootProject.data!.id).select("name, kind").single();
    expect(renamed.error).toBeNull();
    expect(renamed.data).toEqual({ name: "Own project, renamed", kind: "project" });
    // No move under its own subtree, with the kind unchanged.
    const deeper = must(
      await userA().from("nodes").insert({ owner_id: a!.id, kind: "subproject", name: "Deeper", parent_id: below.data!.id }).select("id").single(),
      "insert deeper",
    );
    const cycle = await userA().from("nodes").update({ parent_id: deeper.id }).eq("id", below.data!.id);
    expect(cycle.error?.code).toBe("23514");
    expect(cycle.error?.message).toContain("own subtree");
  });
});

describe("items", () => {
  it("A does not read B's items", async () => {
    const { data, error } = await userA().from("items").select("id").eq("id", treeB.item);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot insert an item into B's node", async () => {
    const { error } = await userA().from("items").insert({ node_id: treeB.subproject, type: "task", title: "Forged" });
    expect(error?.code).toBe("42501");
  });

  it("A cannot change or delete B's item", async () => {
    const changed = await userA().from("items").update({ title: "Hijacked" }).eq("id", treeB.item).select("id");
    expect(changed.data).toEqual([]);
    const deleted = await userA().from("items").delete().eq("id", treeB.item).select("id");
    expect(deleted.data).toEqual([]);
    const still = must(await serviceClient().from("items").select("title").eq("id", treeB.item).single(), "read B item");
    expect(still.title).toBe("B first task");
  });

  it("A cannot move its own item into B's node", async () => {
    const { error } = await userA().from("items").update({ node_id: treeB.subproject }).eq("id", treeA.item);
    expect(error?.code).toBe("42501");
  });

  it("the item rules hold: priority only on tasks, a link needs its URL", async () => {
    const decision = await userA()
      .from("items")
      .insert({ node_id: treeA.project, type: "decision", title: "Use Workers", priority: 1 });
    expect(decision.error?.code).toBe("23514");
    const link = await userA().from("items").insert({ node_id: treeA.project, type: "link", title: "No URL" });
    expect(link.error?.code).toBe("23514");
  });
});

describe("accounts and tokens", () => {
  it("A does not read B's accounts and never reads a token column", async () => {
    const others = await userA().from("google_accounts").select("id, email").eq("id", treeB.account);
    expect(others.error).toBeNull();
    expect(others.data).toEqual([]);
    const own = await userA().from("google_accounts").select("refresh_token").eq("id", treeA.account);
    expect(own.error?.code).toBe("42501");
  });

  it("A cannot write accounts: the server does", async () => {
    const inserted = await userA().from("google_accounts").insert({ owner_id: a!.id, email: "forged@example.com" });
    expect(inserted.error?.code).toBe("42501");
    const updated = await userA().from("google_accounts").update({ email: "changed@example.com" }).eq("id", treeA.account);
    expect(updated.error?.code).toBe("42501");
  });

  it("A cannot attach B's account to its node, nor its account to B's node", async () => {
    const foreignAccount = await userA().from("node_accounts").insert({ node_id: treeA.root, account_id: treeB.account });
    expect(foreignAccount.error?.code).toBe("42501");
    const foreignNode = await userA().from("node_accounts").insert({ node_id: treeB.root, account_id: treeA.account });
    expect(foreignNode.error?.code).toBe("42501");
  });

  it("A cannot detach B's account or delete it", async () => {
    const detached = await userA().from("node_accounts").delete().eq("node_id", treeB.root).select("node_id");
    expect(detached.data).toEqual([]);
    const deleted = await userA().from("google_accounts").delete().eq("id", treeB.account).select("id");
    expect(deleted.data).toEqual([]);
    const still = await serviceClient().from("node_accounts").select("node_id").eq("node_id", treeB.root);
    expect(still.data).toHaveLength(1);
  });

  it("A issues tokens only on its own nodes and never reads a hash", async () => {
    const own = await userA()
      .from("agent_tokens")
      .insert({ node_id: treeA.project, token_hash: `hash-${crypto.randomUUID()}`, label: "laptop" })
      .select("id, label")
      .single();
    expect(own.error).toBeNull();
    const foreign = await userA()
      .from("agent_tokens")
      .insert({ node_id: treeB.project, token_hash: `hash-${crypto.randomUUID()}`, label: "forged" });
    expect(foreign.error?.code).toBe("42501");
    const hash = await userA().from("agent_tokens").select("token_hash").eq("node_id", treeA.project);
    expect(hash.error?.code).toBe("42501");
  });

  it("the workspace's conversation and each node's belong to their owner", async () => {
    // Without a node a message is the workspace's own conversation; its owner is the signed-in person by default.
    const own = await userA().from("chat_messages").insert({ node_id: null, role: "user", parts: [{ type: "text", text: "A asks" }] }).select("id, owner_id").single();
    expect(own.error).toBeNull();
    expect(own.data!.owner_id).toBe(a!.id);
    const theirs = must(
      await b!.client.from("chat_messages").insert({ node_id: null, role: "user", parts: [{ type: "text", text: "B asks" }] }).select("id").single(),
      "B's message",
    );
    const read = await userA().from("chat_messages").select("id").in("id", [own.data!.id, theirs.id]);
    expect(read.data?.map((row) => row.id)).toEqual([own.data!.id]);
    const forged = await userA().from("chat_messages").insert({ owner_id: b!.id, node_id: null, role: "user", parts: [] });
    expect(forged.error?.code).toBe("42501");
    const intoForeignNode = await userA().from("chat_messages").insert({ node_id: treeB.project, role: "user", parts: [] });
    expect(intoForeignNode.error?.code).toBe("42501");
    const deleted = await userA().from("chat_messages").delete().eq("id", theirs.id).select("id");
    expect(deleted.data).toEqual([]);
  });

  it("A cannot write its own usage counters", async () => {
    const { error } = await userA()
      .from("usage_counters")
      .insert({ owner_id: a!.id, day: "2026-01-01", kind: "chat_message", count: 0 });
    expect(error?.code).toBe("42501");
  });

  it("a visitor without a session reads nothing", async () => {
    const { error } = await publicClient().from("nodes").select("id").limit(1);
    expect(error?.code).toBe("42501");
  });
});

describe("events, the task inside an event, versions, and saved views", () => {
  async function eventOf(user: DisposableUser, node: string, title: string) {
    return must(
      await user.client
        .from("events")
        .insert({ node_id: node, title, all_day: true, starts_on: "2026-11-02", ends_on: "2026-11-02" })
        .select("id")
        .single(),
      `insert event ${title}`,
    ).id;
  }

  it("A does not read, write into, change, or delete B's events", async () => {
    const own = await eventOf(a!, treeA.project, "A meeting");
    const foreign = await eventOf(b!, treeB.project, "B meeting");
    const read = await userA().from("events").select("id").in("id", [own, foreign]);
    expect(read.data?.map((row) => row.id)).toEqual([own]);
    const inserted = await userA().from("events").insert({ node_id: treeB.project, title: "Forged", all_day: true, starts_on: "2026-11-02", ends_on: "2026-11-02" });
    expect(inserted.error?.code).toBe("42501");
    const changed = await userA().from("events").update({ title: "Hijacked" }).eq("id", foreign).select("id");
    expect(changed.data).toEqual([]);
    const deleted = await userA().from("events").delete().eq("id", foreign).select("id");
    expect(deleted.data).toEqual([]);
    const still = must(await serviceClient().from("events").select("title").eq("id", foreign).single(), "read B event");
    expect(still.title).toBe("B meeting");
    // The shape of a moment: a whole day carries days, a timed event carries instants.
    const mixed = await userA().from("events").insert({ node_id: treeA.project, title: "Mixed", all_day: true, starts_at: "2026-11-02T10:00:00Z", ends_at: "2026-11-02T11:00:00Z" });
    expect(mixed.error?.code).toBe("23514");
  });

  it("a task lives in one event of its owner: never in B's event, never a decision", async () => {
    const own = await eventOf(a!, treeA.project, "A review");
    const foreign = await eventOf(b!, treeB.project, "B review");
    const linked = await userA().from("item_events").insert({ item_id: treeA.item, event_id: own }).select("item_id");
    expect(linked.error).toBeNull();
    const twice = await userA().from("item_events").insert({ item_id: treeA.item, event_id: own });
    expect(twice.error?.code).toBe("23505");
    await userA().from("item_events").delete().eq("item_id", treeA.item);
    const intoForeign = await userA().from("item_events").insert({ item_id: treeA.item, event_id: foreign });
    expect(intoForeign.error?.code).toBe("42501");
    const foreignTask = await userA().from("item_events").insert({ item_id: treeB.item, event_id: own });
    expect(foreignTask.error?.code).toBe("42501");
    const read = await userA().from("item_events").select("item_id").eq("item_id", treeB.item);
    expect(read.data).toEqual([]);
  });

  it("versions are written by the database and only read by their owner", async () => {
    must(await userA().from("items").update({ title: "A first task, renamed" }).eq("id", treeA.item).select("id"), "rename");
    const own = await userA().from("revisions").select("id, snapshot").eq("item_id", treeA.item);
    expect(own.data?.length).toBeGreaterThan(0);
    must(await b!.client.from("items").update({ title: "B renamed" }).eq("id", treeB.item).select("id"), "rename B");
    const foreign = await userA().from("revisions").select("id").eq("item_id", treeB.item);
    expect(foreign.data).toEqual([]);
    const forged = await userA().from("revisions").insert({ item_id: treeA.item, snapshot: {}, source: "manual" });
    expect(forged.error?.code).toBe("42501");
    const rewritten = await userA().from("revisions").update({ snapshot: {} }).eq("item_id", treeA.item);
    expect(rewritten.error?.code).toBe("42501");
  });

  it("the branch functions reach nothing of another owner", async () => {
    const deleted = await userA().rpc("delete_item_branch", { p_item: treeB.item, p_source: "manual", p_agent_label: null as unknown as string });
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual([]);
    const still = must(await serviceClient().from("items").select("deleted_at").eq("id", treeB.item).single(), "read B item");
    expect(still.deleted_at).toBeNull();
  });

  it("saved views belong to their owner", async () => {
    const own = must(await userA().from("saved_views").insert({ owner_id: a!.id, name: "Urgent", query: "view=all&priority=1" }).select("id").single(), "save view");
    const forged = await userA().from("saved_views").insert({ owner_id: b!.id, name: "Forged", query: "x" });
    expect(forged.error?.code).toBe("42501");
    const bView = must(await b!.client.from("saved_views").insert({ owner_id: b!.id, name: "Mine", query: "y" }).select("id").single(), "B view");
    const read = await userA().from("saved_views").select("id").in("id", [own.id, bView.id]);
    expect(read.data?.map((row) => row.id)).toEqual([own.id]);
    const deleted = await userA().from("saved_views").delete().eq("id", bView.id).select("id");
    expect(deleted.data).toEqual([]);
  });

  it("a visitor without a session reads none of them", async () => {
    for (const table of ["events", "item_events", "revisions", "saved_views"] as const) {
      const { error } = await publicClient().from(table).select("*").limit(1);
      expect(error?.code).toBe("42501");
    }
  });
});

describe("tree functions", () => {
  it("node_subtree returns the node and all its descendants", async () => {
    const { data, error } = await userA().rpc("node_subtree", { root: treeA.root });
    expect(error).toBeNull();
    expect(new Set(data?.map((row) => row.id))).toEqual(new Set([treeA.root, treeA.project, treeA.subproject]));
  });

  it("node_subtree sees nothing of another owner's tree", async () => {
    const { data, error } = await userA().rpc("node_subtree", { root: treeB.root });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a leaf sees its own account and the one inherited from the root, each with where it comes from", async () => {
    const { data, error } = await userA().rpc("visible_accounts", { node: treeA.subproject });
    expect(error).toBeNull();
    const byAccount = new Map(data?.map((row) => [row.account_id, row.from_node_id]));
    expect(byAccount).toEqual(
      new Map([
        [treeA.account, treeA.root],
        [treeA.leafAccount, treeA.subproject],
      ]),
    );
  });

  it("the root sees only its own account", async () => {
    const { data, error } = await userA().rpc("visible_accounts", { node: treeA.root });
    expect(error).toBeNull();
    expect(data?.map((row) => row.account_id)).toEqual([treeA.account]);
  });
});
