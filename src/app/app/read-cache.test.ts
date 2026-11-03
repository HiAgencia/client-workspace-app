import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, peekGet, peekTool, post, tool, toolKey } from "./client-api";
import { FRESH_MS, forgetReads, isFresh, keep, KEPT_LIMIT, onRefreshes, peek, readsInFlight, refreshEnded, refreshesInFlight, refreshStarted, stamp, wrote } from "./read-cache";




const fine = (value: unknown) => () => Response.json({ ok: true, value });

function answers(...responses: Array<() => Response>) {
  let call = 0;
  const fetched = vi.fn(async () => responses[Math.min(call++, responses.length - 1)]());
  vi.stubGlobal("fetch", fetched);
  return fetched;
}


function held() {
  let answer: (response: Response) => void = () => {};
  const fetched = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
  vi.stubGlobal("fetch", fetched);
  return { fetched, answer: (value: unknown) => answer(Response.json({ ok: true, value })) };
}

beforeEach(() => forgetReads());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("what the cache keeps", () => {
  it("gives back the last answer of a read, with the moment it was asked", () => {
    const asked = stamp();
    keep("a", { n: 1 }, asked);
    expect(peek("a")).toEqual({ value: { n: 1 }, at: asked.at });
    expect(peek("b")).toBeNull();
  });

  it("never lets an older read replace a newer one that answered first", () => {
    const older = stamp();
    const newer = stamp();
    keep("a", "newer", newer);
    keep("a", "older", older);
    expect(peek("a")?.value).toBe("newer");
  });

  it("forgets everything on a write, and keeps nothing whose read began before it", () => {
    const before = stamp();
    keep("a", 1, stamp());
    wrote();
    expect(peek("a")).toBeNull();
    keep("b", 2, before);
    expect(peek("b")).toBeNull();
    keep("c", 3, stamp());
    expect(peek("c")?.value).toBe(3);
  });

  it("holds a bounded number of answers, the one longest without use leaving first", () => {
    for (let index = 0; index < KEPT_LIMIT; index++) keep(`k${index}`, index, stamp());
    
    expect(peek("k0")?.value).toBe(0);
    keep("one more", "x", stamp());
    expect(peek("k0")?.value).toBe(0);
    expect(peek("k1")).toBeNull();
    expect(peek("one more")?.value).toBe("x");
  });

  it("says when a page reads again behind what it shows, apart from every other read", () => {
    const heard: number[] = [];
    const stop = onRefreshes(() => heard.push(refreshesInFlight()));
    refreshStarted();
    refreshStarted();
    refreshEnded();
    refreshEnded();
    stop();
    expect(heard).toEqual([1, 0]);
    expect(readsInFlight()).toBe(0);
  });

  it("calls an answer fresh only for a moment after it was asked, and never one with no age", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const asked = stamp();
    expect(isFresh({ value: 1, at: asked.at })).toBe(true);
    expect(isFresh({ value: 1, at: asked.at }, asked.at + FRESH_MS + 1)).toBe(false);
    expect(isFresh({ value: 1, at: 0 })).toBe(false);
  });
});

describe("the screens' reads and writes", () => {
  it("keep what a read answered, by its tool and input", async () => {
    answers(fine(1));
    await tool("get_tasks", { today: "2026-11-02" });
    expect(peekTool("get_tasks", { today: "2026-11-02" })?.value).toEqual({ ok: true, value: 1 });
    expect(peekTool("get_tasks", { today: "2026-11-03" })).toBeNull();
  });

  it("keep no failure: a page that could not read shows it, and reads again", async () => {
    answers(() => Response.json({ ok: false, message: "no" }, { status: 422 }));
    await tool("get_tasks", { today: "2026-11-02" });
    expect(peekTool("get_tasks", { today: "2026-11-02" })).toBeNull();
  });

  it("never paint a read that was on its way while a write started: it may not hold the change", async () => {
    const read = held();
    const answered = tool("get_tasks", { today: "2026-11-02" });
    
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    const writing = tool("update_item", { id: "t", status: "done" });
    read.answer(1);
    await Promise.all([answered, writing]);
    expect(peekTool("get_tasks", { today: "2026-11-02" })).toBeNull();
  });

  it("never paint a read that began while a write was on its way, and keep the one asked after it ended", async () => {
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (url.includes("update_item") ? new Promise<Response>((resolve) => (finish = resolve)) : Promise.resolve(Response.json({ ok: true, value: "during" })))),
    );
    const writing = tool("update_item", { id: "t", dueOn: "2026-11-03" });
    await tool("get_tasks", { today: "2026-11-02" });
    finish(Response.json({ ok: true }));
    await writing;
    expect(peekTool("get_tasks", { today: "2026-11-02" })).toBeNull();
    answers(fine("after"));
    await tool("get_tasks", { today: "2026-11-02" });
    expect(peekTool("get_tasks", { today: "2026-11-02" })?.value).toEqual({ ok: true, value: "after" });
  });

  it("forget what was read on any write of a page's data, but not when only the order of the boxes is saved", async () => {
    answers(fine(1));
    await tool("list_notes", { node: null, limit: 12 });
    await post("/api/preferences", { page: "tasks", layout: "board" });
    expect(peekTool("list_notes", { node: null, limit: 12 })).not.toBeNull();
    await post("/api/items/t/restore", {});
    expect(peekTool("list_notes", { node: null, limit: 12 })).toBeNull();
  });

  it("keep the accounts a GET reads, and share one request between two places that ask at once", async () => {
    const fetched = answers(fine([]));
    await Promise.all([get("/api/accounts"), get("/api/accounts")]);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(peekGet("/api/accounts")?.value).toEqual({ ok: true, value: [] });
    
    await Promise.all([get("/api/trash"), get("/api/trash")]);
    expect(fetched).toHaveBeenCalledTimes(3);
  });

  it("count the reads on their way, so the page knows when it has settled", async () => {
    const read = held();
    const answered = tool("get_tasks", { today: "2026-11-02" });
    expect(readsInFlight()).toBe(1);
    read.answer(1);
    await answered;
    expect(readsInFlight()).toBe(0);
  });

  it("take the read the page's HTML started instead of asking again, and ask again when it was cut", async () => {
    const input = { today: "2026-11-02", withMail: true, withNotes: true };
    const early = (globalThis as { __cwEarly?: Record<string, Promise<Response>> });
    early.__cwEarly = { [toolKey("list_tree", input)]: Promise.resolve(Response.json({ ok: true, nodes: [] })) };
    const fetched = answers(fine("asked"));
    expect(await tool("list_tree", input)).toEqual({ ok: true, nodes: [] });
    expect(fetched).not.toHaveBeenCalled();
    
    await tool("list_tree", input);
    expect(fetched).toHaveBeenCalledTimes(1);

    early.__cwEarly = { [toolKey("list_tree", input)]: Promise.resolve(new Response(null, { status: 503 })) };
    const again = answers(fine("second"));
    expect(await tool("list_tree", input)).toEqual({ ok: true, value: "second" });
    expect(again).toHaveBeenCalledTimes(1);
    delete early.__cwEarly;
  });
});
