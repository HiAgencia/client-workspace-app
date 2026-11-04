import { afterEach, describe, expect, it, vi } from "vitest";
import { WRITES, type WriteOutput } from "./chat-cards";

type Sent = { url: string; body: unknown };

function capture(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("the chat's cards", () => {
  it("taking a task out of its own event puts it back in that event", async () => {
    const sent = capture();
    const card = WRITES.unlink_task_event({
      ok: true,
      task: "t1",
      title: "Send the [homepage](https://example.com) draft",
      removed: true,
      link: { itemId: "t1", eventId: "e1", accountId: null, calendarId: null, googleEventId: null },
    });
    expect(card?.what).toBe("Unlinked “Send the homepage draft” from its calendar event");
    await card?.undo?.();
    expect(sent).toEqual([{ url: "/api/tools/link_task_event", body: { task: "t1", event: "e1" } }]);
  });

  it("taking a task out of a Google event puts it back by its account, calendar, and id", async () => {
    const sent = capture();
    const card = WRITES.unlink_task_event({
      ok: true,
      task: "t2",
      title: "Call the bank",
      removed: true,
      link: { itemId: "t2", eventId: null, accountId: "a1", calendarId: "primary", googleEventId: "g1" },
    });
    await card?.undo?.();
    expect(sent).toEqual([{ url: "/api/tools/link_task_event", body: { task: "t2", account: "a1", calendar: "primary", googleEvent: "g1" } }]);
  });

  it("a task that was in no event shows no card", () => {
    expect(WRITES.unlink_task_event({ ok: true, task: "t3", title: "Nothing", removed: false, link: null })).toBeNull();
  });

  it("a reorder goes back to the order the places held", async () => {
    const sent = capture();
    const card = WRITES.reorder_items({
      ok: true,
      items: [
        { id: "b", title: "B", position: 1, previous: 2 },
        { id: "a", title: "A", position: 2, previous: 1 },
      ],
    });
    expect(card?.what).toBe("Reordered 2 tasks");
    await card?.undo?.();
    expect(sent).toEqual([{ url: "/api/tools/reorder_items", body: { ids: ["a", "b"] } }]);
  });

  it("what a task waits for goes back whole —its account, its words, since when, and what it ruled out— or to none", async () => {
    const sent = capture();
    const since = "2026-11-02T14:05:09.123456+00:00";
    const now = { accountId: null, waitsFor: "Bayside", since, dismissed: [] };
    const changed = WRITES.set_task_mail({ ok: true, task: "t4", title: "Wait for the transfer", mail: now, previous: { accountId: "a1", waitsFor: "Bayside Bank", since, dismissed: ["a1:m2"] } });
    expect(changed?.what).toBe("“Wait for the transfer” waits for mail with “Bayside”");
    await changed?.undo?.();
    const started = WRITES.set_task_mail({ ok: true, task: "t4", title: "Wait for the transfer", mail: now, previous: null });
    await started?.undo?.();
    expect(sent).toEqual([
      { url: "/api/tools/set_task_mail", body: { task: "t4", waiting: true, account: "a1", words: "Bayside Bank", since, dismissed: ["a1:m2"] } },
      { url: "/api/tools/set_task_mail", body: { task: "t4", waiting: false } },
    ]);
  });

  it("a reply ruled out comes back among the possible ones", async () => {
    const sent = capture();
    const card = WRITES.dismiss_reply({ ok: true, task: "t5", title: "Wait for the transfer", reply: { account: "a1", id: "m1", dismissed: true } });
    expect(card?.what).toBe("Dismissed a possible reply to “Wait for the transfer”");
    await card?.undo?.();
    expect(sent).toEqual([{ url: "/api/tools/dismiss_reply", body: { task: "t5", account: "a1", id: "m1", dismissed: false } }]);
  });

  it("a task closed with its result opens again in one call, which finds what the closing left", async () => {
    const closed = WRITES.complete_task({ ok: true, item: { id: "t6", title: "Wait for the app review", type: "task" }, decision: { id: "d6", title: "Approved" } });
    expect(closed?.what).toBe("Completed “Wait for the app review”: Approved");
    const sent = capture();
    await closed?.undo?.();
    expect(sent).toEqual([{ url: "/api/tools/reopen_task", body: { task: "t6" } }]);
  });

  it("makes a closing taken back again, with its words and its message, and marks done a task that had neither", async () => {
    const task = { id: "t7", title: "Wait for the app review", type: "task" as const };
    const opened = (closing: WriteOutput["closing"]) => WRITES.reopen_task({ ok: true, item: task, closing });
    expect(opened(null)?.what).toBe("Reopened “Wait for the app review”");
    const sent = capture();
    await opened({ outcome: "Approved", notes: "<p>From Meta</p>", reply: { account: "a1", id: "m7" } })?.undo?.();
    await opened({ outcome: "Rejected", notes: null, reply: null })?.undo?.();
    await opened(null)?.undo?.();
    expect(sent).toEqual([
      { url: "/api/tools/complete_task", body: { task: "t7", outcome: "Approved", notes: "<p>From Meta</p>", reply: { account: "a1", id: "m7" } } },
      { url: "/api/tools/complete_task", body: { task: "t7", outcome: "Rejected" } },
      { url: "/api/tools/update_item", body: { id: "t7", status: "done" } },
    ]);
  });
});
