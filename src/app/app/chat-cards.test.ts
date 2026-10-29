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
});
