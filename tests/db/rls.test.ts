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
    expect(error).not.toBeNull();
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

  it("the tree rules hold: a root is a client, a client's child is a project, no move under its own subtree", async () => {
    const rootProject = await userA().from("nodes").insert({ owner_id: a!.id, kind: "project", name: "Loose" });
    expect(rootProject.error?.code).toBe("23514");
    const wrongChild = await userA()
      .from("nodes")
      .insert({ owner_id: a!.id, kind: "subproject", name: "Wrong", parent_id: treeA.root });
    expect(wrongChild.error?.code).toBe("23514");
    const cycle = await userA()
      .from("nodes")
      .update({ parent_id: treeA.subproject, kind: "subproject" })
      .eq("id", treeA.project);
    expect(cycle.error?.code).toBe("23514");
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
