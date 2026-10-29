import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NODE_COLORS } from "@/lib/node-colors";
import type { ToolContext } from "@/lib/tools/context";
import { restoreItem } from "@/lib/tools/items";
import { callTool } from "@/lib/tools/registry";
import type { ToolError } from "@/lib/tools/result";
import type { TaskRow, TasksView } from "@/lib/tools/tasks";
import { changeNode, changeNodeInput } from "@/lib/tools/tree-writes";
import { createDisposableUser, deleteDisposableUsers, serviceClient, type DisposableUser } from "../support/supabase";

// The tools of tasks with an optional place, against the real Supabase project with disposable owners. The owner has
// Plan Co → Site → Checkout and a project of its own, Own, besides General; an agent's token is scoped to Site. The day
// is fixed: every tool takes the person's day as input.

const TODAY = "2026-10-28";
const day = (offset: number) => {
  const date = new Date(`${TODAY}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

let owner: DisposableUser | undefined;
let other: DisposableUser | undefined;
const ids = { client: "", site: "", checkout: "", own: "", foreignNode: "", foreignEvent: "" };

type Item = { id: string; nodeId: string | null; nodePath: string | null; parentId: string | null; type: string; title: string; dueOn: string | null; dueTime: string | null; position: number; updatedAt: string };

function me(extra: Partial<ToolContext> = {}): ToolContext {
  if (!owner) throw new Error("the test owner was not created");
  return { db: owner.client, ownerId: owner.id, source: "manual", ...extra };
}

// What the MCP server builds for a token on Site.
function agent(scopeNodeId = ids.site): ToolContext {
  return { db: serviceClient(), ownerId: owner!.id, scopeNodeId, source: "agent", agentLabel: "laptop" };
}

async function run<T = Record<string, unknown>>(name: string, ctx: ToolContext, input: unknown): Promise<T> {
  const result = await callTool(name, ctx, input);
  if (!result.ok) throw new Error(`${name} failed: ${(result as ToolError).code} ${(result as ToolError).message}`);
  return result as T;
}

async function refuse(name: string, ctx: ToolContext, input: unknown): Promise<ToolError> {
  const result = await callTool(name, ctx, input);
  expect(result.ok).toBe(false);
  return result as ToolError;
}

async function task(input: Record<string, unknown>, ctx = me()): Promise<Item> {
  return (await run<{ item: Item }>("create_task", ctx, input)).item;
}

async function node(user: DisposableUser, kind: "client" | "project" | "subproject", name: string, parent?: string) {
  const { data, error } = await user.client.from("nodes").insert({ owner_id: user.id, kind, name, parent_id: parent ?? null }).select("id").single();
  if (error) throw new Error(`insert ${name}: ${error.message}`);
  return data.id;
}

const titles = (rows: TaskRow[]) => rows.map((row) => row.title);

beforeAll(async () => {
  owner = await createDisposableUser("tasks");
  other = await createDisposableUser("tasks-other");
  ids.client = await node(owner, "client", "Plan Co");
  ids.site = await node(owner, "project", "Site", ids.client);
  ids.checkout = await node(owner, "subproject", "Checkout", ids.site);
  ids.own = await node(owner, "project", "Own");
  ids.foreignNode = await node(other, "client", "Elsewhere");
  const { data, error } = await other.client
    .from("events")
    .insert({ node_id: ids.foreignNode, title: "Their event", all_day: true, starts_on: TODAY, ends_on: TODAY })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  ids.foreignEvent = data.id;
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([owner, other]);
}, 60_000);

describe("get_tasks", () => {
  // Written once, read by every case below.
  const made: Record<string, Item> = {};

  beforeAll(async () => {
    made.late = await task({ node: ids.site, title: "Late on the site", dueOn: day(-2), priority: 2 });
    made.timedLate = await task({ title: "General at half past nine", dueOn: TODAY, dueTime: "09:30", priority: 3 });
    made.timed = await task({ node: ids.site, title: "Site at four", dueOn: TODAY, dueTime: "16:00", priority: 4, notes: "<p>First line</p><p>Second line</p>" });
    made.urgent = await task({ node: ids.own, title: "Own urgent", dueOn: TODAY, priority: 1 });
    made.tomorrow = await task({ node: ids.checkout, title: "Checkout tomorrow", dueOn: day(1) });
    made.inThree = await task({ title: "General in three days", dueOn: day(3) });
    made.later = await task({ node: ids.site, title: "Site in ten days", dueOn: day(10) });
    made.undatedA = await task({ title: "General without a date" });
    made.undatedB = await task({ node: ids.site, title: "Site without a date" });
    // A subtask without a date lives only in its parent's row; one with a date shows where it falls due.
    made.hiddenSub = await task({ parent: made.undatedA.id, title: "Undated step" });
    made.datedSub = await task({ parent: made.undatedB.id, title: "Dated step", dueOn: TODAY });
    made.doneSub = await task({ parent: made.undatedB.id, title: "Finished step" });
    await run("update_item", me(), { id: made.doneSub.id, status: "done" });
    await run("add_note", me(), { parent: made.timed.id, text: "A note on the task" });
    await run("add_decision", me(), { node: ids.site, decision: "Not a task" });
    made.finished = await task({ node: ids.own, title: "Finished today", dueOn: TODAY });
    await run("update_item", me(), { id: made.finished.id, status: "done" });
    await changeNode(me(), ids.client, { color: "teal" });
  }, 60_000);

  it("cuts the day into its four groups, each with its count, a timed task first in its day", async () => {
    const view = await run<TasksView>("get_tasks", me(), { today: TODAY });
    expect(view.day).toBe(TODAY);
    expect(view.scope).toEqual({ kind: "all", id: null, path: null });
    expect(titles(view.groups.overdue.tasks)).toEqual(["Late on the site"]);
    expect(titles(view.groups.today.tasks)).toEqual(["General at half past nine", "Site at four", "Own urgent", "Dated step"]);
    expect(view.groups.today.count).toBe(4);
    expect(view.groups.upcoming.days.map((entry) => [entry.day, titles(entry.tasks)])).toEqual([
      [day(1), ["Checkout tomorrow"]],
      [day(3), ["General in three days"]],
      [day(10), ["Site in ten days"]],
    ]);
    expect(view.groups.upcoming).toMatchObject({ count: 3, hidden: 0 });
    expect(titles(view.groups.noDate.tasks)).toEqual(["General without a date", "Site without a date"]);
    // Neither the undated subtask nor the finished task is in a group; completed is not asked.
    const everywhere = [view.groups.overdue, view.groups.today, view.groups.noDate].flatMap((group) => titles(group.tasks));
    expect(everywhere).not.toContain("Undated step");
    expect(everywhere).not.toContain("Finished today");
    expect(view.completed).toBeNull();
  });

  it("says on each row what the row shows: its place and color, its subtasks, its notes, its first line", async () => {
    const view = await run<TasksView>("get_tasks", me(), { today: TODAY });
    const byTitle = new Map([...view.groups.today.tasks, ...view.groups.noDate.tasks].map((row) => [row.title, row]));
    expect(byTitle.get("Site at four")).toMatchObject({
      path: "Plan Co / Site",
      color: "teal",
      dueTime: "16:00",
      description: "First line",
      notes: 1,
      mail: null,
      source: "manual",
    });
    expect(byTitle.get("General at half past nine")).toMatchObject({ nodeId: null, path: null, color: null });
    expect(byTitle.get("Site without a date")?.subtasks).toEqual({ done: 1, total: 2 });
    expect(byTitle.get("General without a date")?.subtasks).toEqual({ done: 0, total: 1 });
    expect(byTitle.get("Dated step")?.parentId).toBe(made.undatedB.id);
    expect(byTitle.get("Own urgent")?.color).toBeNull();
  });

  it("reads General alone, or a node and what is below it, and caps the upcoming days for a box", async () => {
    const general = await run<TasksView>("get_tasks", me(), { node: null, today: TODAY });
    expect(general.scope.kind).toBe("general");
    expect(titles(general.groups.today.tasks)).toEqual(["General at half past nine"]);
    expect(titles(general.groups.noDate.tasks)).toEqual(["General without a date"]);
    const site = await run<TasksView>("get_tasks", me(), { node: "Plan Co / Site", today: TODAY });
    expect(site.scope).toEqual({ kind: "node", id: ids.site, path: "Plan Co / Site" });
    expect(titles(site.groups.today.tasks)).toEqual(["Site at four", "Dated step"]);
    expect(site.groups.upcoming.days.map((entry) => entry.day)).toEqual([day(1), day(10)]);
    const capped = await run<TasksView>("get_tasks", me(), { today: TODAY, upcomingDays: 2 });
    expect(capped.groups.upcoming).toMatchObject({ count: 3, hidden: 1 });
    expect(capped.groups.upcoming.days).toHaveLength(2);
  });

  it("brings the finished tasks when asked, and sorts by priority or by hand", async () => {
    const withDone = await run<TasksView>("get_tasks", me(), { today: TODAY, withCompleted: true });
    // A finished subtask without a day lives in its parent's row, as an open one does.
    expect(titles(withDone.completed!.tasks)).toEqual(["Finished today"]);
    expect(withDone.groups.today.count).toBe(4);
    const byPriority = await run<TasksView>("get_tasks", me(), { today: TODAY, sort: "priority" });
    expect(titles(byPriority.groups.today.tasks)).toEqual(["Own urgent", "General at half past nine", "Site at four", "Dated step"]);
    const byHand = await run<TasksView>("get_tasks", me(), { today: TODAY, sort: "manual" });
    // By hand is the order they were written in until someone reorders them.
    expect(titles(byHand.groups.today.tasks)).toEqual(["General at half past nine", "Site at four", "Own urgent", "Dated step"]);
  });

  it("is cut on the day it is given, not the server's", async () => {
    const tomorrow = await run<TasksView>("get_tasks", me(), { today: day(1) });
    expect(titles(tomorrow.groups.today.tasks)).toEqual(["Checkout tomorrow"]);
    expect(tomorrow.groups.overdue.count).toBe(5);
  });

  it("an agent's token reads its own subtree and never General", async () => {
    const own = await run<TasksView>("get_tasks", agent(), { today: TODAY });
    expect(own.scope).toEqual({ kind: "node", id: ids.site, path: "Plan Co / Site" });
    const seen = [own.groups.overdue, own.groups.today, own.groups.noDate].flatMap((group) => titles(group.tasks));
    expect(seen).not.toContain("General at half past nine");
    expect(seen).not.toContain("General without a date");
    expect((await refuse("get_tasks", agent(), { node: null, today: TODAY })).code).toBe("not_found");
    // The switch off: the same service client without the scope reads General.
    const unscoped = await run<TasksView>("get_tasks", { ...agent(), scopeNodeId: undefined }, { node: null, today: TODAY });
    expect(unscoped.groups.noDate.count).toBe(1);
  });
});

describe("creating with an hour, and the hour's rules", () => {
  it("an hour needs its day, is written as HH:MM, and goes with its day", async () => {
    expect((await refuse("create_task", me(), { title: "No day", dueTime: "10:00" })).code).toBe("invalid_input");
    expect((await refuse("create_task", me(), { title: "Bad hour", dueOn: TODAY, dueTime: "25:00" })).code).toBe("invalid_input");
    const timed = await task({ node: ids.own, title: "At ten", dueOn: TODAY, dueTime: "10:00" });
    expect(timed.dueTime).toBe("10:00");
    const moved = await run<{ item: Item; previous: { dueTime: string | null } }>("update_item", me(), { id: timed.id, dueTime: "11:45" });
    expect(moved.item.dueTime).toBe("11:45");
    expect(moved.previous.dueTime).toBe("10:00");
    const undated = await run<{ item: Item }>("update_item", me(), { id: timed.id, dueOn: null });
    expect(undated.item).toMatchObject({ dueOn: null, dueTime: null });
    expect((await refuse("update_item", me(), { id: timed.id, dueTime: "09:00" })).code).toBe("invalid_input");
  });

  it("a new task enters last in the manual order", async () => {
    const first = await task({ title: "Written first" });
    const second = await task({ node: ids.site, title: "Written second" });
    expect(second.position).toBeGreaterThan(first.position);
  });
});

describe("move_item", () => {
  it("moves a task with its subtasks and notes to another node, to General, and under another task, and says where it was", async () => {
    const parent = await task({ node: ids.site, title: "Moving parent" });
    const child = await task({ parent: parent.id, title: "Moving child" });
    const { item: note } = await run<{ item: Item }>("add_note", me(), { parent: parent.id, text: "Moving note" });
    const toOwn = await run<{ item: Item; previous: { nodeId: string | null; parentId: string | null }; branch: number }>("move_item", me(), { id: parent.id, node: ids.own });
    expect(toOwn.item.nodeId).toBe(ids.own);
    expect(toOwn.previous).toEqual({ nodeId: ids.site, parentId: null });
    expect(toOwn.branch).toBe(3);
    const rows = await owner!.client.from("items").select("id, node_id").in("id", [child.id, note.id]);
    expect(rows.data?.every((row) => row.node_id === ids.own)).toBe(true);

    const toGeneral = await run<{ item: Item }>("move_item", me(), { id: parent.id, node: null });
    expect(toGeneral.item.nodeId).toBeNull();
    const general = await owner!.client.from("items").select("node_id").in("id", [child.id, note.id]);
    expect(general.data?.every((row) => row.node_id === null)).toBe(true);

    const host = await task({ node: ids.checkout, title: "Host task" });
    const under = await run<{ item: Item }>("move_item", me(), { id: parent.id, parent: host.id });
    expect(under.item).toMatchObject({ nodeId: ids.checkout, parentId: host.id });
    const out = await run<{ item: Item }>("move_item", me(), { id: parent.id, parent: null });
    expect(out.item).toMatchObject({ nodeId: ids.checkout, parentId: null });
  });

  it("refuses a cycle, a parent that is not a task, and a parent in another place than the node named", async () => {
    const top = await task({ node: ids.site, title: "Top" });
    const below = await task({ parent: top.id, title: "Below" });
    expect((await refuse("move_item", me(), { id: top.id, parent: below.id })).code).toBe("invalid_input");
    expect((await refuse("move_item", me(), { id: top.id, parent: top.id })).code).toBe("invalid_input");
    const { item: note } = await run<{ item: Item }>("add_note", me(), { node: ids.site, text: "A note" });
    expect((await refuse("move_item", me(), { id: top.id, parent: note.id })).code).toBe("invalid_input");
    expect((await refuse("move_item", me(), { id: below.id, node: ids.own, parent: top.id })).code).toBe("invalid_input");
    // The database holds the same rule for any writer: a parent moved alone leaves its child behind and is refused.
    const alone = await owner!.client.from("items").update({ node_id: ids.own }).eq("id", top.id);
    expect(alone.error?.code).toBe("23514");
  });

  it("an agent moves within its subtree, never to General or out of it", async () => {
    const mine = await task({ node: ids.site, title: "Agent moves this" });
    const moved = await run<{ item: Item }>("move_item", agent(), { id: mine.id, node: ids.checkout });
    expect(moved.item.nodeId).toBe(ids.checkout);
    expect((await refuse("move_item", agent(), { id: mine.id, node: null })).code).toBe("not_found");
    expect((await refuse("move_item", agent(), { id: mine.id, node: ids.own })).code).toBe("not_found");
  });
});

describe("reorder_items", () => {
  it("deals the group's own places out in the order given, leaves the rest and the moment of the last change alone", async () => {
    const a = await task({ title: "Order A" });
    const b = await task({ title: "Order B" });
    const c = await task({ title: "Order C" });
    const outside = await task({ title: "Outside the group" });
    const before = await owner!.client.from("items").select("id, position, updated_at").in("id", [a.id, b.id, c.id, outside.id]);
    const was = new Map(before.data!.map((row) => [row.id, row]));
    const result = await run<{ items: Array<{ id: string; position: number; previous: number }> }>("reorder_items", me(), { ids: [c.id, a.id, b.id] });
    expect(result.items.map((entry) => entry.id)).toEqual([c.id, a.id, b.id]);
    const positions = result.items.map((entry) => entry.position);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(new Set(positions)).toEqual(new Set([a, b, c].map((item) => Number(was.get(item.id)!.position))));
    const after = await owner!.client.from("items").select("id, position, updated_at").in("id", [a.id, b.id, c.id, outside.id]);
    for (const row of after.data!) expect(row.updated_at).toBe(was.get(row.id)!.updated_at);
    expect(after.data!.find((row) => row.id === outside.id)!.position).toBe(was.get(outside.id)!.position);
    const view = await run<TasksView>("get_tasks", me(), { node: null, today: TODAY });
    const order = titles(view.groups.noDate.tasks).filter((title) => title.startsWith("Order"));
    expect(order).toEqual(["Order C", "Order A", "Order B"]);
    // Back to the first order: each item holds its own place again, to the last digit the database keeps.
    await run("reorder_items", me(), { ids: [a.id, b.id, c.id] });
    const back = await owner!.client.from("items").select("id, position").in("id", [a.id, b.id, c.id]);
    for (const row of back.data!) expect(String(row.position)).toBe(String(was.get(row.id)!.position));
  });

  it("refuses an id it does not reach and an id given twice", async () => {
    const mine = await task({ title: "Mine to order" });
    const { data } = await other!.client.from("items").insert({ node_id: ids.foreignNode, type: "task", title: "Theirs" }).select("id").single();
    expect((await refuse("reorder_items", me(), { ids: [mine.id, data!.id] })).code).toBe("not_found");
    expect((await refuse("reorder_items", me(), { ids: [mine.id, mine.id] })).code).toBe("invalid_input");
    expect((await refuse("reorder_items", agent(), { ids: [mine.id] })).code).toBe("not_found");
  });
});

describe("reschedule_overdue", () => {
  it("moves every overdue task of a view to one day and says each one's previous day", async () => {
    const fresh = await createDisposableUser("reschedule");
    try {
      const ctx: ToolContext = { db: fresh.client, ownerId: fresh.id, source: "manual" };
      const place = await node(fresh, "project", "Place");
      const inPlace = await task({ node: place, title: "Late in the place", dueOn: day(-3), dueTime: "08:00" }, ctx);
      const general = await task({ title: "Late in General", dueOn: day(-1) }, ctx);
      await task({ title: "Due today", dueOn: TODAY }, ctx);
      expect((await refuse("reschedule_overdue", ctx, { today: TODAY, to: day(-1) })).code).toBe("invalid_input");
      const onlyPlace = await run<{ count: number; changed: Array<{ id: string; previousDueOn: string }> }>("reschedule_overdue", ctx, { node: place, today: TODAY, to: TODAY });
      expect(onlyPlace.changed).toEqual([{ id: inPlace.id, title: "Late in the place", previousDueOn: day(-3) }]);
      const rest = await run<{ count: number; changed: Array<{ id: string; previousDueOn: string }> }>("reschedule_overdue", ctx, { today: TODAY, to: day(1) });
      expect(rest.changed.map((entry) => entry.id)).toEqual([general.id]);
      const view = await run<TasksView>("get_tasks", ctx, { today: TODAY });
      expect(view.groups.overdue.count).toBe(0);
      // The hour stays with the task.
      const kept = await fresh.client.from("items").select("due_on, due_time").eq("id", inPlace.id).single();
      expect(kept.data).toEqual({ due_on: TODAY, due_time: "08:00:00" });
      const again = await run<{ count: number }>("reschedule_overdue", ctx, { today: TODAY, to: TODAY });
      expect(again.count).toBe(0);
    } finally {
      await deleteDisposableUsers([fresh]);
    }
  });
});

describe("notes", () => {
  it("a note lives in a node, under a task, or loose, and list_notes reads each place with its decision mark", async () => {
    const { item: loose } = await run<{ item: Item }>("add_note", me(), { node: null, text: "A loose thought" });
    expect(loose.nodeId).toBeNull();
    // A link written over its words becomes a link in the body; the title keeps it over its words.
    const { item: inNode } = await run<{ item: Item & { body: string } }>("add_note", me(), { node: ids.checkout, text: "[The brief](https://brief.example/doc) for checkout" });
    expect(inNode.title).toBe("[The brief](https://brief.example/doc) for checkout");
    expect(inNode.body).toBe('<p><a href="https://brief.example/doc">The brief</a> for checkout</p>');
    const changed = await run<{ item: Item & { body: string } }>("update_item", me(), { id: inNode.id, notes: "[The brief](https://brief.example/doc) for checkout" });
    expect(changed.item.title).toBe("[The brief](https://brief.example/doc) for checkout");
    const host = await task({ node: ids.checkout, title: "Task with notes" });
    const { item: onTask } = await run<{ item: Item }>("add_note", me(), { parent: host.id, text: "On the task" });
    const { item: decided } = await run<{ item: Item }>("add_decision", me(), { node: ids.checkout, decision: "Card payments only" });

    type Notes = { scope: { kind: string; id: string | null }; notes: Array<{ id: string; decision: boolean; path: string | null; color: string | null; parentId: string | null }>; total: number };
    const general = await run<Notes>("list_notes", me(), { node: null });
    expect(general.scope.kind).toBe("general");
    expect(general.notes.map((note) => note.id)).toContain(loose.id);
    expect(general.notes.every((note) => note.path === null)).toBe(true);

    const site = await run<Notes>("list_notes", me(), { node: ids.site });
    const siteIds = site.notes.map((note) => note.id);
    expect(siteIds).toEqual(expect.arrayContaining([inNode.id, decided.id]));
    expect(siteIds).not.toContain(onTask.id);
    expect(siteIds).not.toContain(loose.id);
    expect(site.notes.find((note) => note.id === decided.id)).toMatchObject({ decision: true, path: "Plan Co / Site / Checkout", color: "teal" });
    expect(site.notes.find((note) => note.id === inNode.id)?.decision).toBe(false);
    const own = await run<Notes>("list_notes", me(), { node: ids.site, subtree: false });
    expect(own.notes.map((note) => note.id)).not.toContain(inNode.id);

    const ofTask = await run<Notes>("list_notes", me(), { parent: host.id });
    expect(ofTask.scope).toMatchObject({ kind: "task", id: host.id });
    expect(ofTask.notes.map((note) => note.id)).toEqual([onTask.id]);
    const decisions = await run<Notes>("list_notes", me(), { node: ids.checkout, decisionsOnly: true });
    expect(decisions.notes.map((note) => note.id)).toEqual([decided.id]);
    const limited = await run<Notes>("list_notes", me(), { node: ids.checkout, limit: 1 });
    expect(limited.notes).toHaveLength(1);
    expect(limited.total).toBe(2);
  });

  it("a note is marked as a decision and back, keeping its words", async () => {
    const { item: note } = await run<{ item: Item }>("add_note", me(), { node: ids.own, text: "<p>Ship on Fridays</p><p>Fewer surprises on Mondays.</p>" });
    const marked = await run<{ item: Item; previous: { type: string } }>("update_item", me(), { id: note.id, decision: true });
    expect(marked.item).toMatchObject({ type: "decision", title: "Ship on Fridays" });
    expect(marked.previous.type).toBe("note");
    const { item: decision } = await run<{ item: Item & { body: string | null } }>("add_decision", me(), { node: ids.own, decision: "Weekly demos", rationale: "Everyone sees progress." });
    const unmarked = await run<{ item: Item & { body: string | null } }>("update_item", me(), { id: decision.id, decision: false });
    expect(unmarked.item).toMatchObject({ type: "note", title: "Weekly demos", body: "<p>Weekly demos</p><p>Everyone sees progress.</p>" });
    const plain = await task({ node: ids.own, title: "A task stays a task" });
    expect((await refuse("update_item", me(), { id: plain.id, decision: true })).code).toBe("invalid_input");
  });

  it("an agent reads the notes of its subtree, never the loose ones", async () => {
    const { item: loose } = await run<{ item: Item }>("add_note", me(), { node: null, text: "Private loose note" });
    expect((await refuse("list_notes", agent(), { node: null })).code).toBe("not_found");
    expect((await refuse("update_item", agent(), { id: loose.id, notes: "Changed by an agent" })).code).toBe("not_found");
    const mine = await run<{ notes: Array<{ id: string }> }>("list_notes", agent(), {});
    expect(mine.notes.map((note) => note.id)).not.toContain(loose.id);
    expect((await refuse("add_note", agent(), { node: null, text: "Into General" })).code).toBe("not_found");
  });
});

describe("request_review", () => {
  it("is a task of the day in the agent's node, with the address over its words and who asked", async () => {
    const { item } = await run<{ item: Item & { source: string; agentLabel: string; priority: number } }>("request_review", agent(), {
      title: "Review the checkout pull request",
      url: "https://code.example/pr/12",
      today: TODAY,
    });
    expect(item).toMatchObject({
      type: "task",
      nodeId: ids.site,
      title: "[Review the checkout pull request](https://code.example/pr/12)",
      dueOn: TODAY,
      source: "agent",
      agentLabel: "laptop",
      priority: 4,
    });
    const view = await run<TasksView>("get_tasks", me(), { node: ids.site, today: TODAY });
    expect(view.groups.today.tasks.find((row) => row.id === item.id)).toMatchObject({ source: "agent", agentLabel: "laptop" });
    // Without the person's day it is refused: the server's clock would put it on another day far from UTC.
    expect((await refuse("request_review", agent(), { title: "Look at the build" })).code).toBe("invalid_input");
  });
});

describe("a general task with subtasks and notes", () => {
  it("keeps them in General, counts them on its row, and deletes and restores them as one branch", async () => {
    const parent = await task({ title: "Plan the offsite", priority: 2 });
    const step = await task({ parent: parent.id, title: "Pick the dates" });
    const { item: note } = await run<{ item: Item }>("add_note", me(), { parent: parent.id, text: "By train" });
    expect(step).toMatchObject({ nodeId: null, parentId: parent.id });
    expect(note).toMatchObject({ nodeId: null, parentId: parent.id });
    const view = await run<TasksView>("get_tasks", me(), { node: null, today: TODAY });
    expect(view.groups.noDate.tasks.find((row) => row.id === parent.id)).toMatchObject({ subtasks: { done: 0, total: 1 }, notes: 1, path: null });
    const children = await run<{ items: Item[] }>("list_items", me(), { parent: parent.id });
    expect(children.items.map((item) => item.id).sort()).toEqual([step.id, note.id].sort());
    // A child in another place than its general parent is refused, by the tool and by the database.
    expect((await refuse("create_task", me(), { parent: parent.id, node: ids.own, title: "Elsewhere" })).code).toBe("invalid_input");
    const direct = await owner!.client.from("items").insert({ node_id: ids.own, parent_item_id: parent.id, type: "task", title: "Elsewhere" });
    expect(direct.error?.code).toBe("23514");
    const deleted = await run<{ branch: number }>("delete_item", me(), { id: parent.id });
    expect(deleted.branch).toBe(3);
    const restored = await restoreItem(me(), parent.id);
    expect(restored.ok && restored.branch).toBe(3);
  });

  it("is out of an agent's reach whatever the way in", async () => {
    const general = await task({ title: "Out of the agent's reach" });
    const ctx = agent(ids.client);
    for (const [name, input] of [
      ["update_item", { id: general.id, title: "Reached" }],
      ["delete_item", { id: general.id }],
      ["move_item", { id: general.id, node: ids.site }],
      ["list_items", { parent: general.id }],
      ["list_notes", { parent: general.id }],
      ["create_task", { parent: general.id, title: "Under it" }],
      ["link_task_event", { task: general.id, account: crypto.randomUUID(), calendar: "primary", googleEvent: "g" }],
    ] as const) {
      expect((await refuse(name, ctx, input)).code, name).toBe("not_found");
    }
    const found = await run<{ items: Item[] }>("search_items", ctx, { query: "Out of the agent" });
    expect(found.items).toEqual([]);
    const updates = await run<{ created: Item[] }>("get_updates_since", ctx, { since: "2020-01-01T00:00:00Z" });
    expect(updates.created.map((item) => item.id)).not.toContain(general.id);
    // The switch off: the person's own access reaches it by the same id.
    const reached = await run<{ item: Item }>("update_item", me(), { id: general.id, title: "Out of the agent's reach" });
    expect(reached.item.id).toBe(general.id);
  });
});

describe("events with no node and a node's events", () => {
  it("an event of no node, a project linked to it, and browse_events reading both", async () => {
    type Browsed = { events: Array<{ localId: string | null; nodeId: string | null; linkedNodeIds: string[] }> };
    const { event } = await run<{ event: { id: string; nodeId: string | null; nodePath: string | null } }>("create_event", me(), {
      node: null,
      title: "Call with the bank",
      startsOn: day(1),
    });
    expect(event).toMatchObject({ nodeId: null, nodePath: null });
    const range = { from: `${TODAY}T00:00:00Z`, to: `${day(5)}T00:00:00Z`, fromDay: TODAY, toDay: day(4) };
    const everything = await run<Browsed>("browse_events", me(), range);
    expect(everything.events.find((entry) => entry.localId === event.id)).toMatchObject({ nodeId: null, linkedNodeIds: [] });
    const site = await run<Browsed>("browse_events", me(), { ...range, node: ids.site });
    expect(site.events.some((entry) => entry.localId === event.id)).toBe(false);

    const linked = await run<{ created: boolean; link: { nodeId: string; eventId: string } }>("link_node_event", me(), { node: ids.site, event: event.id });
    expect(linked).toMatchObject({ created: true, link: { nodeId: ids.site, eventId: event.id } });
    expect((await run<{ created: boolean }>("link_node_event", me(), { node: ids.site, event: event.id })).created).toBe(false);
    const withLink = await run<Browsed>("browse_events", me(), { ...range, node: ids.site });
    expect(withLink.events.find((entry) => entry.localId === event.id)?.linkedNodeIds).toEqual([ids.site]);
    const fromParent = await run<Browsed>("browse_events", me(), { ...range, node: ids.client });
    expect(fromParent.events.some((entry) => entry.localId === event.id)).toBe(true);

    // A general task enters the general event, and the event says so.
    const call = await task({ title: "Prepare the bank call" });
    await run("link_task_event", me(), { task: call.id, event: event.id });
    const withTask = await run<{ events: Array<{ localId: string | null; linkedTaskIds: string[] }> }>("browse_events", me(), range);
    expect(withTask.events.find((entry) => entry.localId === event.id)?.linkedTaskIds).toEqual([call.id]);
    // An agent's token does not see the general task inside it.
    const fromAgent = await run<{ events: Array<{ localId: string | null; linkedTaskIds: string[] }> }>("browse_events", agent(ids.client), range);
    expect(fromAgent.events.flatMap((entry) => entry.linkedTaskIds)).not.toContain(call.id);

    const unlinked = await run<{ removed: boolean }>("unlink_node_event", me(), { node: ids.site, event: event.id });
    expect(unlinked.removed).toBe(true);
    expect((await run<{ removed: boolean }>("unlink_node_event", me(), { node: ids.site, event: event.id })).removed).toBe(false);
  });

  it("refuses another owner's event, a mixed target, and a token's write into General", async () => {
    expect((await refuse("link_node_event", me(), { node: ids.site, event: ids.foreignEvent })).code).toBe("not_found");
    expect((await refuse("link_node_event", me(), { node: ids.foreignNode, event: ids.foreignEvent })).code).toBe("not_found");
    expect((await refuse("link_node_event", me(), { node: ids.site, event: ids.foreignEvent, account: crypto.randomUUID() })).code).toBe("invalid_input");
    expect((await refuse("create_event", agent(), { node: null, title: "Into General", startsOn: TODAY })).code).toBe("not_found");
    const theirs = await serviceClient().from("node_events").select("id").eq("event_id", ids.foreignEvent);
    expect(theirs.data).toEqual([]);
  });
});

describe("list_tree", () => {
  it("each node shows its own color or its nearest ancestor's, and the day's figures count everything in reach", async () => {
    const fresh = await createDisposableUser("tree-colors");
    try {
      const ctx: ToolContext = { db: fresh.client, ownerId: fresh.id, source: "manual" };
      const client = await node(fresh, "client", "Colored");
      const project = await node(fresh, "project", "Inherits", client);
      const sub = await node(fresh, "subproject", "Own color", project);
      expect((await changeNode(ctx, client, { color: "violet" })).ok).toBe(true);
      expect((await changeNode(ctx, sub, { color: "green" })).ok).toBe(true);
      await task({ node: project, title: "Late", dueOn: day(-1) }, ctx);
      await task({ node: sub, title: "Today", dueOn: TODAY }, ctx);
      await task({ title: "General today", dueOn: TODAY }, ctx);
      await task({ title: "General later", dueOn: day(2) }, ctx);
      type Tree = { nodes: Array<{ id: string; color: string | null; ownColor: string | null; openTasks: number }>; tasks: { overdue: number; today: number } | null };
      const tree = await run<Tree>("list_tree", ctx, { today: TODAY });
      const byId = new Map(tree.nodes.map((entry) => [entry.id, entry]));
      expect(byId.get(client)).toMatchObject({ color: "violet", ownColor: "violet", openTasks: 2 });
      expect(byId.get(project)).toMatchObject({ color: "violet", ownColor: null, openTasks: 2 });
      expect(byId.get(sub)).toMatchObject({ color: "green", ownColor: "green", openTasks: 1 });
      expect(tree.tasks).toEqual({ overdue: 1, today: 2 });
      expect((await run<Tree>("list_tree", ctx, {})).tasks).toBeNull();
      const below = await run<Tree>("list_tree", ctx, { node: project, today: TODAY });
      expect(below.tasks).toEqual({ overdue: 1, today: 1 });
      // Clearing a color shows the ancestor's again.
      expect((await changeNode(ctx, sub, { color: null })).ok).toBe(true);
      const cleared = await run<Tree>("list_tree", ctx, {});
      expect(cleared.nodes.find((entry) => entry.id === sub)).toMatchObject({ color: "violet", ownColor: null });
    } finally {
      await deleteDisposableUsers([fresh]);
    }
  });

  it("the palette is the database's: every color of it is written, and one outside it is refused", async () => {
    for (const color of NODE_COLORS) {
      const { error } = await owner!.client.from("nodes").update({ color }).eq("id", ids.own);
      expect(error, color).toBeNull();
    }
    const outside = await owner!.client.from("nodes").update({ color: "chartreuse" }).eq("id", ids.own);
    expect(outside.error?.code).toBe("23514");
    expect(changeNodeInput.safeParse({ color: "chartreuse" }).success).toBe(false);
    expect(changeNodeInput.safeParse({ color: null }).success).toBe(true);
    await owner!.client.from("nodes").update({ color: null }).eq("id", ids.own);
  });
});
