import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instantsOf, weekOf } from "@/lib/dates";
import { activitySince } from "./box-kinds";
import type { TreeNode } from "./client-api";
import { createMailStore, type MailAccountRef } from "./mail-store";
import { forgetReads } from "./read-cache";
import { warmPage, type Warmth } from "./warm-reads";

const TODAY = "2026-11-02";
const NODE = "11111111-1111-4111-8111-111111111111";
const tree: TreeNode[] = [{ id: NODE, parentId: null, kind: "client", name: "Acme", path: "Acme", openTasks: 1, color: null, ownColor: null }];
const accounts: MailAccountRef[] = [{ id: "a1", email: "a@example.com", isDemo: true, status: "active", nodeId: NODE, nodeIds: [NODE] }];
const week = weekOf(TODAY, 1);
const instants = instantsOf(week.from, week.to);
const WEEK = { from: instants.from, to: instants.to, fromDay: week.from, toDay: week.to };

function server() {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const name = url.replace("/api/tools/", "").replace("/api/", "GET ");
      asked.push(`${name} ${init?.body ?? ""}`.trim());
      const answer = name === "browse_events" ? { ok: true, events: [], failures: [], accounts: [], toRead: [] } : { ok: true, groups: { forTasks: { count: 0, messages: [] }, unread: { count: 0, messages: [] }, earlier: { count: 0, messages: [] } }, unreadByAccount: {}, failures: [], countFailures: [], replies: [], more: [] };
      return Response.json(answer);
    }),
  );
  return asked;
}

const listed: string[] = [];
const NO_MAIL = { forTasks: { count: 0, messages: [] }, unread: { count: 0, messages: [] }, earlier: { count: 0, messages: [] } };

function warmth(): Warmth {
  const mailStore = createMailStore(async (name, input) => {
    listed.push(`${name} ${input.account}`);
    return { ok: true, groups: NO_MAIL, unread: 0, unreadByAccount: {}, failures: [], countFailures: [] };
  });
  return { today: TODAY, weekStart: 1, tree, accounts, waiting: [], mailStore };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => forgetReads());
afterEach(() => vi.unstubAllGlobals());

describe("warming a page", () => {
  it("reads what Tasks asks first, and nothing again once it is kept", async () => {
    const asked = server();
    warmPage("/app/tasks", warmth());
    await settle();
    expect(asked).toEqual([`get_tasks ${JSON.stringify({ today: TODAY, sort: "date", withCompleted: false })}`, `browse_events ${JSON.stringify(WEEK)}`]);
    warmPage("/app/tasks", warmth());
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("reads the Overview's boxes with the inputs they ask with, and its accounts' mail", async () => {
    const asked = server();
    listed.length = 0;
    warmPage("/app", warmth());
    await settle();
    expect(asked).toEqual(
      expect.arrayContaining([
        `get_tasks ${JSON.stringify({ today: TODAY, upcomingDays: 3 })}`,
        `list_notes ${JSON.stringify({ node: null, limit: 12 })}`,
        `get_updates_since ${JSON.stringify({ since: activitySince() })}`,
        `browse_events ${JSON.stringify(WEEK)}`,
      ]),
    );
    expect(listed).toEqual(["list_mail a1"]);
  });

  it("reads a place's page over that place, and the calendar with its accounts", async () => {
    const asked = server();
    warmPage(`/app/node/${NODE}`, warmth());
    warmPage("/app/calendar", warmth());
    await settle();
    expect(asked).toEqual(
      expect.arrayContaining([
        `get_tasks ${JSON.stringify({ node: NODE, today: TODAY, upcomingDays: 3 })}`,
        `list_notes ${JSON.stringify({ node: NODE, limit: 12 })}`,
        `browse_events ${JSON.stringify({ node: NODE, ...WEEK })}`,
        `get_tasks ${JSON.stringify({ today: TODAY, withCompleted: true })}`,
        "GET accounts",
        `browse_events ${JSON.stringify(WEEK)}`,
      ]),
    );
  });

  it("reads nothing for a page it does not know", async () => {
    const asked = server();
    warmPage("/app/settings", warmth());
    warmPage("https://elsewhere.example/app", warmth());
    await settle();
    expect(asked).toEqual([]);
  });
});
