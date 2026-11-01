import { describe, expect, it } from "vitest";
import { columnsOf, FOOT, orderDropped, orderMovedTo, settleLayout, SPLIT, steppedOrder } from "./board-layout";

const DEFAULTS = ["tasks", SPLIT, "calendar", "mail", FOOT, "no_date", "notes", "activity"];

describe("a page's order of boxes", () => {
  it("starts in the page's own order", () => {
    expect(settleLayout(null, DEFAULTS)).toEqual({ order: DEFAULTS, hidden: [] });
    expect(columnsOf({ order: DEFAULTS, hidden: [] })).toEqual([["tasks"], ["calendar", "mail"], ["no_date", "notes", "activity"]]);
  });

  it("keeps an order stored before the row existed in its columns, with the row empty", () => {
    const settled = settleLayout({ order: ["tasks", "activity", SPLIT, "calendar", "mail", "no_date", "notes"], hidden: ["notes"] }, DEFAULTS);
    expect(columnsOf(settled)).toEqual([["tasks", "activity"], ["calendar", "mail", "no_date", "notes"], []]);
    expect(settled.hidden).toEqual(["notes"]);
  });

  it("drops what the page no longer has, and a box the page added enters at the end of the zone its default gives it", () => {
    const settled = settleLayout({ order: ["old_box", "tasks", SPLIT, "calendar", FOOT, "notes"], hidden: ["old_box", SPLIT, FOOT] }, DEFAULTS);
    expect(columnsOf(settled)).toEqual([["tasks"], ["calendar", "mail"], ["notes", "no_date", "activity"]]);
    expect(settled.hidden).toEqual([]);
  });

  it("reads a stored order with its marks out of place as columns and a row all the same", () => {
    const settled = settleLayout({ order: [FOOT, "tasks", SPLIT, "calendar", "mail", "no_date", "notes", "activity"], hidden: [] }, DEFAULTS);
    expect(columnsOf(settled)).toEqual([["tasks"], ["calendar", "mail", "no_date", "notes", "activity"], []]);
  });

  it("where the zones stand apart, a box at a zone's end steps into the next zone and a step back returns it", () => {
    const down = steppedOrder(DEFAULTS, DEFAULTS, "mail", 1, true)!;
    expect(columnsOf({ order: down, hidden: [] })).toEqual([["tasks"], ["calendar"], ["mail", "no_date", "notes", "activity"]]);
    expect(steppedOrder(down, down, "mail", -1, true)).toEqual(DEFAULTS);
  });

  it("where they read as one column, a step always passes the next box", () => {
    const down = steppedOrder(DEFAULTS, DEFAULTS, "mail", 1, false)!;
    const read = columnsOf({ order: down, hidden: [] }).flat();
    expect(read).toEqual(["tasks", "calendar", "no_date", "mail", "notes", "activity"]);
  });

  it("steps only among what is in view, and stops at either end", () => {
    const inView = DEFAULTS.filter((id) => id !== "calendar");
    const up = steppedOrder(DEFAULTS, inView, "mail", -1, false)!;
    expect(columnsOf({ order: up, hidden: [] }).flat()).toEqual(["mail", "tasks", "calendar", "no_date", "notes", "activity"]);
    expect(steppedOrder(DEFAULTS, DEFAULTS, "tasks", -1, true)).toBeNull();
    expect(steppedOrder(DEFAULTS, DEFAULTS, "activity", 1, false)).toBeNull();
  });

  it("moves a box to the end of any zone, from any zone", () => {
    expect(columnsOf({ order: orderMovedTo(DEFAULTS, "tasks", 1), hidden: [] })).toEqual([[], ["calendar", "mail", "tasks"], ["no_date", "notes", "activity"]]);
    expect(columnsOf({ order: orderMovedTo(DEFAULTS, "calendar", 2), hidden: [] })).toEqual([["tasks"], ["mail"], ["no_date", "notes", "activity", "calendar"]]);
    expect(columnsOf({ order: orderMovedTo(DEFAULTS, "activity", 0), hidden: [] })).toEqual([["tasks", "activity"], ["calendar", "mail"], ["no_date", "notes"]]);
  });

  it("drops a box before another or at the end of a zone, leaving every other box where it was", () => {
    expect(columnsOf({ order: orderDropped(DEFAULTS, "notes", "calendar", 1), hidden: [] })).toEqual([["tasks"], ["notes", "calendar", "mail"], ["no_date", "activity"]]);
    expect(columnsOf({ order: orderDropped(DEFAULTS, "tasks", "activity", 2), hidden: [] })).toEqual([[], ["calendar", "mail"], ["no_date", "notes", "tasks", "activity"]]);
    expect(orderDropped(DEFAULTS, "mail", null, 1)).toEqual(DEFAULTS);
  });
});
