import { describe, expect, it } from "vitest";
import { activates, gridMove } from "./grid-keys";

// The month: five weeks of seven days.
const MONTH = { rows: 5, cols: 7 };

describe("walking a calendar grid with the keys", () => {
  it("moves a cell with each arrow, and stops at the edges", () => {
    expect(gridMove("ArrowRight", { row: 2, col: 3 }, MONTH)).toEqual({ row: 2, col: 4 });
    expect(gridMove("ArrowLeft", { row: 2, col: 3 }, MONTH)).toEqual({ row: 2, col: 2 });
    expect(gridMove("ArrowDown", { row: 2, col: 3 }, MONTH)).toEqual({ row: 3, col: 3 });
    expect(gridMove("ArrowUp", { row: 2, col: 3 }, MONTH)).toEqual({ row: 1, col: 3 });
    expect(gridMove("ArrowLeft", { row: 0, col: 0 }, MONTH)).toEqual({ row: 0, col: 0 });
    expect(gridMove("ArrowRight", { row: 4, col: 6 }, MONTH)).toEqual({ row: 4, col: 6 });
    expect(gridMove("ArrowDown", { row: 4, col: 1 }, MONTH)).toEqual({ row: 4, col: 1 });
  });

  it("goes to the row's ends with Home and End, and to the grid's with Ctrl", () => {
    expect(gridMove("Home", { row: 3, col: 4 }, MONTH)).toEqual({ row: 3, col: 0 });
    expect(gridMove("End", { row: 3, col: 4 }, MONTH)).toEqual({ row: 3, col: 6 });
    expect(gridMove("Home", { row: 3, col: 4 }, MONTH, true)).toEqual({ row: 0, col: 0 });
    expect(gridMove("End", { row: 3, col: 4 }, MONTH, true)).toEqual({ row: 4, col: 6 });
  });

  it("jumps by rows with Page Up and Page Down, inside the grid", () => {
    // The week: the all-day row and eleven hours.
    const week = { rows: 12, cols: 7 };
    expect(gridMove("PageDown", { row: 1, col: 2 }, week)).toEqual({ row: 5, col: 2 });
    expect(gridMove("PageDown", { row: 10, col: 2 }, week)).toEqual({ row: 11, col: 2 });
    expect(gridMove("PageUp", { row: 2, col: 2 }, week)).toEqual({ row: 0, col: 2 });
  });

  it("leaves every other key to the cell", () => {
    expect(gridMove("Enter", { row: 0, col: 0 }, MONTH)).toBeNull();
    expect(gridMove("a", { row: 0, col: 0 }, MONTH)).toBeNull();
    expect(activates("Enter")).toBe(true);
    expect(activates(" ")).toBe(true);
    expect(activates("Escape")).toBe(false);
  });
});
