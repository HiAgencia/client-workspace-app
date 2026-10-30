import { afterEach, describe, expect, it, vi } from "vitest";
import { WRITES } from "./chat-cards";

// The chat's cards say what a write did from its tool's output and undo it through the same tools: what each undo
// sends is read from the request it makes.

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
    expect(card?.what).toBe("Took “Send the homepage draft” out of its event");
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
    expect(card?.what).toBe("Ruled out a reply to “Wait for the transfer”");
    await card?.undo?.();
    expect(sent).toEqual([{ url: "/api/tools/dismiss_reply", body: { task: "t5", account: "a1", id: "m1", dismissed: false } }]);
  });

  it("a task closed with its result opens again, its result goes, and the reply comes off it only when the closing linked it", async () => {
    const closed = (created: boolean) =>
      WRITES.complete_task({
        ok: true,
        item: { id: "t6", title: "Wait for the app review", type: "task" },
        decision: { id: "d6", title: "Approved" },
        link: { accountId: "a1", messageId: "m6", created },
      });
    expect(closed(true)?.what).toBe("Closed “Wait for the app review”: Approved");
    const sent = capture();
    await closed(true)?.undo?.();
    await closed(false)?.undo?.();
    expect(sent).toEqual([
      { url: "/api/tools/update_item", body: { id: "t6", status: "open" } },
      { url: "/api/tools/delete_item", body: { id: "d6" } },
      { url: "/api/tools/unlink_mail", body: { account: "a1", id: "m6", task: "t6" } },
      { url: "/api/tools/update_item", body: { id: "t6", status: "open" } },
      { url: "/api/tools/delete_item", body: { id: "d6" } },
    ]);
  });
});
