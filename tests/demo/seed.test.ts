import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoSeedTree } from "@/lib/demo-seed";
import { createDisposableUser, deleteDisposableUsers, publicClient, type DisposableUser } from "../support/supabase";

// The demo seed is one database call; this test keeps its result identical to the TypeScript tree the first step names,
// and keeps a second call from planting anything. The tree's own unit test lives beside it in `src/lib/demo-seed.test.ts`.

const TODAY = "2026-10-27";
type Tree = ReturnType<typeof demoSeedTree>;
type ExpectedNode = { path: string; kind: string; position: number };
type ExpectedItem = {
  path: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  priority: number | null;
  dueOn: string | null;
  status: string;
  source: string;
};

function expectedNodes(): ExpectedNode[] {
  const rows: ExpectedNode[] = [];
  const walk = (nodes: Tree, parent: string, depth: number) => {
    nodes.forEach((node, position) => {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      rows.push({ path, kind: depth === 0 ? "client" : depth === 1 ? "project" : "subproject", position });
      walk(node.children ?? [], path, depth + 1);
    });
  };
  walk(demoSeedTree(TODAY), "", 0);
  return rows;
}

function expectedItems(): ExpectedItem[] {
  const rows: ExpectedItem[] = [];
  const walk = (nodes: Tree, parent: string) => {
    for (const node of nodes) {
      const path = parent ? `${parent} / ${node.name}` : node.name;
      for (const [tool, input] of node.items ?? []) {
        const row: ExpectedItem = {
          path,
          type: "",
          title: "",
          body: null,
          url: null,
          priority: null,
          dueOn: null,
          status: "open",
          source: "manual",
        };
        if (tool === "create_task") {
          row.type = "task";
          row.title = String(input.title);
          row.body = input.notes ? String(input.notes) : null;
          row.priority = input.priority ? Number(input.priority) : 4;
          row.dueOn = input.dueOn ? String(input.dueOn) : null;
        } else if (tool === "add_decision") {
          row.type = "decision";
          row.title = String(input.decision);
          row.body = input.rationale ? String(input.rationale) : null;
        } else if (tool === "add_link") {
          row.type = "link";
          row.title = String(input.title ?? input.url);
          row.url = String(input.url);
        } else if (tool === "add_review") {
          row.type = "review";
          row.title = String(input.title);
          row.url = input.url ? String(input.url) : null;
        } else {
          throw new Error(`the demo tree uses an unknown tool: ${tool}`);
        }
        rows.push(row);
      }
      walk(node.children ?? [], path);
    }
  };
  walk(demoSeedTree(TODAY), "");
  return rows;
}

type NodeRow = { id: string; parent_id: string | null; kind: string; name: string; position: number };

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
  user = await createDisposableUser("demo-seed");
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user]);
}, 60_000);

describe("the demo seed", () => {
  it("plants the whole tree in one call and leaves the same workspace demoSeedTree describes", async () => {
    if (!user) throw new Error("the test user was not created");
    const first = await user.client.rpc("seed_demo", { p_today: TODAY });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    const nodes = await user.client.from("nodes").select("id, parent_id, kind, name, position");
    expect(nodes.error).toBeNull();
    const nodeRows = (nodes.data ?? []) as NodeRow[];
    const byId = new Map(nodeRows.map((row) => [row.id, row]));
    const actualNodes = nodeRows.map((row) => ({ path: pathOf(row, byId), kind: row.kind, position: row.position }));

    const items = await user.client.from("items").select("node_id, type, title, body, url, priority, due_on, status, source");
    expect(items.error).toBeNull();
    const actualItems = (items.data ?? []).map((row) => ({
      path: pathOf(byId.get(row.node_id)!, byId),
      type: row.type,
      title: row.title,
      body: row.body,
      url: row.url,
      priority: row.priority,
      dueOn: row.due_on,
      status: row.status,
      source: row.source,
    }));

    expect(actualNodes.sort((a, b) => a.path.localeCompare(b.path))).toEqual(expectedNodes().sort((a, b) => a.path.localeCompare(b.path)));
    expect(actualItems.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      expectedItems().sort((a, b) => key(a).localeCompare(key(b))),
    );
    expect(actualNodes).toHaveLength(6);
    expect(actualItems).toHaveLength(11);

    const second = await user.client.rpc("seed_demo", { p_today: TODAY });
    expect(second.error).toBeNull();
    expect(second.data).toBe(false);
    const after = await user.client.from("nodes").select("id", { count: "exact", head: true });
    expect(after.count).toBe(6);
  });

  it("two calls at once plant one tree", async () => {
    const race = await createDisposableUser("demo-seed-race");
    try {
      const [first, second] = await Promise.all([
        race.client.rpc("seed_demo", { p_today: TODAY }),
        race.client.rpc("seed_demo", { p_today: TODAY }),
      ]);
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect([first.data, second.data].sort()).toEqual([false, true]);
      const nodes = await race.client.from("nodes").select("id", { count: "exact", head: true });
      expect(nodes.count).toBe(6);
    } finally {
      await deleteDisposableUsers([race]);
    }
  });

  it("cannot run without a session, and each owner sees only its own tree", async () => {
    if (!user) throw new Error("the test user was not created");
    await user.client.rpc("seed_demo", { p_today: TODAY });
    const other = await createDisposableUser("demo-seed-other");
    try {
      const anonymous = await publicClient().rpc("seed_demo", { p_today: TODAY });
      expect(anonymous.error?.code).toBe("42501");
      const seeded = await other.client.rpc("seed_demo", { p_today: TODAY });
      expect(seeded.data).toBe(true);
      const mine = await user.client.from("nodes").select("id");
      const theirs = await other.client.from("nodes").select("id");
      expect(mine.data).toHaveLength(6);
      expect(theirs.data).toHaveLength(6);
      const mineIds = new Set((mine.data ?? []).map((node) => node.id));
      expect((theirs.data ?? []).every((node) => !mineIds.has(node.id))).toBe(true);
    } finally {
      await deleteDisposableUsers([other]);
    }
  });
});
