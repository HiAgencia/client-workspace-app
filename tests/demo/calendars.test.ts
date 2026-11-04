import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoSeedTree, type Seed, type SeedAccount } from "@/lib/demo-seed";
import { demoEventsSource } from "@/lib/google/events";
import type { ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";
import { createAnonymousUser, deleteDisposableUsers, type DisposableUser } from "../support/supabase";

const TODAY = "2026-10-27";
const WEEK = { from: "2026-10-26T00:00:00.000Z", to: "2026-11-03T00:00:00.000Z", fromDay: "2026-10-26", toDay: "2026-11-02" };
const accountsOf = (node: Seed): SeedAccount[] => [...(node.accounts ?? []), ...(node.children ?? []).flatMap(accountsOf)];
const MEETINGS: Record<string, string[]> = Object.fromEntries(
  demoSeedTree(TODAY)
    .flatMap(accountsOf)
    .flatMap((account) => (account.calendar ? [[account.calendar.name, account.calendar.meetings.filter((meeting) => meeting.day >= WEEK.fromDay && meeting.day <= WEEK.toDay).map((meeting) => meeting.title)]] : [])),
);
const EVERY_MEETING = Object.values(MEETINGS).flat().sort();

type Browsed = { ok: boolean; events: Array<{ origin: string; title: string; calendarName?: string; accountEmail?: string; fromNodeId?: string; allDay: boolean }>; failures: unknown[] };
type Tree = { nodes: Array<{ id: string; path: string; parentId: string | null }>; mail: { accounts: Array<{ id: string; email: string; isDemo: boolean; status: string; nodeId: string }> } };

let user: DisposableUser | undefined;
let stranger: DisposableUser | undefined;
let nodeOf: (path: string) => string;
let samples: Tree["mail"]["accounts"];

const contextOf = (who: DisposableUser, withSource = true): ToolContext => ({ db: who.client, ownerId: who.id, source: "manual", events: withSource ? demoEventsSource() : undefined });
const meetingsIn = (answer: Browsed) => answer.events.filter((event) => event.origin === "google");
const titlesIn = (answer: Browsed) => meetingsIn(answer).map((event) => event.title).sort();

beforeAll(async () => {
  [user, stranger] = await Promise.all([createAnonymousUser("demo-calendars"), createAnonymousUser("demo-calendars-stranger")]);
  const planted = await user.client.rpc("seed_demo", { p_today: TODAY });
  expect(planted.error).toBeNull();
  const tree = (await callTool("list_tree", contextOf(user), { withMail: true })) as unknown as Tree;
  samples = tree.mail.accounts;
  nodeOf = (path) => {
    const found = tree.nodes.find((node) => node.path === path);
    if (!found) throw new Error(`no node at ${path}`);
    return found.id;
  };
}, 60_000);

afterAll(async () => {
  await deleteDisposableUsers([user, stranger]);
}, 60_000);

describe("the demo's calendars", () => {
  it("bring each meeting once over everything, at its hours, from more than one account", async () => {
    const answer = (await callTool("browse_events", contextOf(user!), WEEK)) as unknown as Browsed & { toRead: string[] };
    expect(answer.ok).toBe(true);
    expect(answer.failures).toEqual([]);
    expect(answer.toRead).toEqual([]);
    expect(titlesIn(answer)).toEqual(EVERY_MEETING);
    const meetings = meetingsIn(answer);
    expect(meetings.every((event) => event.allDay === false)).toBe(true);
    expect(new Set(meetings.map((event) => event.accountEmail)).size).toBe(Object.keys(MEETINGS).length);
  });

  it("show a node what hangs from it and above it, and nothing else", async () => {
    const client = (await callTool("browse_events", contextOf(user!), { ...WEEK, node: nodeOf("Larkspur Bakery") })) as unknown as Browsed;
    expect(titlesIn(client)).toEqual([...MEETINGS["Larkspur Bakery"]].sort());
    const inside = (await callTool("browse_events", contextOf(user!), { ...WEEK, node: nodeOf("Larkspur Bakery / Website") })) as unknown as Browsed;
    expect(titlesIn(inside)).toEqual([...MEETINGS["Larkspur Bakery"]].sort());
    expect(new Set(meetingsIn(inside).map((event) => event.fromNodeId))).toEqual(new Set([nodeOf("Larkspur Bakery")]));
    const bare = (await callTool("browse_events", contextOf(user!), { ...WEEK, node: nodeOf("Lumen Dental") })) as unknown as Browsed;
    expect(meetingsIn(bare)).toEqual([]);
    expect(bare.failures).toEqual([]);
  });

  it("bring nothing to another person, whoever they say they are", async () => {
    const own = (await callTool("browse_events", contextOf(stranger!), WEEK)) as unknown as Browsed;
    expect(own.ok).toBe(true);
    expect(meetingsIn(own)).toEqual([]);
    const answers = await Promise.all(samples.map((account) => demoEventsSource()({ db: stranger!.client, ownerId: user!.id, account, nodeId: account.nodeId, from: WEEK.from, to: WEEK.to })));
    expect(samples.length).toBeGreaterThan(1);
    expect(answers.flatMap((answer) => answer.events)).toEqual([]);
  });

  it("are not there without the source: the screens read them from it", async () => {
    const answer = (await callTool("browse_events", contextOf(user!, false), WEEK)) as unknown as Browsed;
    expect(meetingsIn(answer)).toEqual([]);
  });

  it("cost the same whatever the accounts: a read of every sample account asks once per range", async () => {
    let asked = 0;
    const counting = new Proxy(user!.client, {
      get(target, key, receiver) {
        if (key !== "from") return Reflect.get(target, key, receiver);
        return (table: string) => {
          asked++;
          return target.from(table as never);
        };
      },
    });
    const source = demoEventsSource();
    const read = (to: string) => Promise.all(samples.map((account) => source({ db: counting, ownerId: user!.id, account, nodeId: account.nodeId, from: WEEK.from, to })));
    const answers = await read(WEEK.to);
    expect(samples.length).toBeGreaterThan(1);
    expect(asked).toBe(1);
    expect(answers.flatMap((answer) => answer.events).map((event) => event.title).sort()).toEqual(EVERY_MEETING);
    await read("2026-11-04T00:00:00.000Z");
    expect(asked).toBe(2);
  });
});
