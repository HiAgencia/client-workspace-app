import { describe, expect, it } from "vitest";
import { cascade, KEEP, type Placed } from "./cascade";


const at = (hour: number, minute = 0) => hour * 60 + minute;
const LINE = 30;
const event = (name: string, start: number, end: number) => ({ name, start, end });
const task = (name: string, start: number) => ({ name, start, end: start + LINE, above: true });
const byName = <T extends { name: string }>(placed: Array<Placed<T>>): Record<string, Placed<T>> => Object.fromEntries(placed.map((entry) => [entry.item.name, entry]));

describe("laying out what overlaps on a day's hours", () => {
  it("leaves alone what does not overlap, also two pieces that only touch", () => {
    const placed = byName(cascade([event("menu", at(10), at(11)), event("review", at(11), at(12))], LINE));
    expect(placed.menu).toMatchObject({ inset: 0, textAt: 0, room: 60 });
    expect(placed.review).toMatchObject({ inset: 0, textAt: 0, room: 60 });
  });

  it("sets in what starts later and lays it over, and the title above it keeps its stretch", () => {
    const placed = byName(cascade([task("call", at(11, 30)), event("review", at(11), at(12))], LINE));
    expect(placed.review).toMatchObject({ inset: 0, textAt: 0, room: 30 });
    expect(placed.call.inset).toBeGreaterThan(0);
    expect(placed.call.inset).toBeLessThanOrEqual(1 - KEEP);
    expect(placed.call.layer).toBeGreaterThan(placed.review.layer);
  });

  it("lays the shorter of two that start together over the longer, whose title moves under it", () => {
    const placed = byName(cascade([task("call", at(10)), event("menu", at(10), at(11))], LINE));
    expect(placed.menu).toMatchObject({ inset: 0, textAt: 30, room: 30 });
    expect(placed.call.inset).toBeGreaterThan(0);
    expect(placed.call.layer).toBeGreaterThan(placed.menu.layer);
  });

  it("keeps a task over an event that starts after it, and moves the event's title past the task", () => {
    const placed = byName(cascade([task("call", at(10)), event("menu", at(10, 10), at(11))], LINE));
    expect(placed.call).toMatchObject({ inset: 0, textAt: 0, room: 30 });
    expect(placed.menu.inset).toBeGreaterThan(0);
    expect(placed.call.layer).toBeGreaterThan(placed.menu.layer);
    expect(placed.menu).toMatchObject({ textAt: 20, room: 30 });
  });

  it("keeps cascading three and more, each one keeping its share of the column and a line of its title", () => {
    const three = byName(cascade([event("workshop", at(10), at(12)), event("sync", at(10, 30), at(11, 30)), event("call", at(11), at(11, 30))], LINE));
    expect([three.workshop.inset, three.sync.inset, three.call.inset]).toEqual([0, expect.any(Number), expect.any(Number)]);
    expect(three.workshop.inset).toBeLessThan(three.sync.inset);
    expect(three.sync.inset).toBeLessThan(three.call.inset);
    for (const name of ["workshop", "sync", "call"]) expect(three[name].room).toBeGreaterThanOrEqual(LINE);
    const many = cascade(Array.from({ length: 6 }, (_, i) => event(`e${i}`, at(9, i * 10), at(13))), LINE);
    for (const entry of many) expect(1 - entry.inset).toBeGreaterThanOrEqual(KEEP - 1e-9);
    expect(new Set(many.map((entry) => entry.inset)).size).toBe(6);
  });

  it("shares no step with a run that ended before", () => {
    const placed = byName(cascade([event("a", at(9), at(10)), event("b", at(9, 30), at(10)), event("c", at(14), at(15))], LINE));
    expect(placed.c.inset).toBe(0);
  });

  it("leaves a title where it is when nothing of its piece stays free, and ends it where the piece over it begins", () => {
    const placed = byName(cascade([task("first", at(9)), task("second", at(9))], LINE));
    const [under, over] = [placed.first, placed.second].sort((a, b) => a.layer - b.layer);
    expect(under).toMatchObject({ textAt: 0, room: LINE, clip: over.inset });
    expect(over.inset).toBeGreaterThan(under.inset);
    expect(over.clip).toBe(1);
  });

  it("reaches the column's edge with the text of every piece that keeps a stretch of its own", () => {
    const placed = cascade([event("review", at(11), at(12)), task("call", at(11, 30)), event("workshop", at(11), at(13))], LINE);
    for (const entry of placed) expect(entry.clip).toBe(1);
  });
});
