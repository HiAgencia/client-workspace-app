import { describe, expect, it } from "vitest";
import { count } from "./count";
import { EVENTS, MESSAGES, TASKS, withCount } from "./place-filters";

// A filter's option says its number with the word the locale's plural rules pick, the same `count` every other number of
// the workspace goes through.
describe("a filter's count", () => {
  it("says one in the singular", () => {
    expect(withCount("All places", 1, TASKS)).toBe("All places (1 task)");
    expect(withCount("ops@example.com", 1, MESSAGES)).toBe("ops@example.com (1 message)");
  });

  it("says none and several in the plural", () => {
    expect(withCount("General", 0, TASKS)).toBe("General (0 tasks)");
    expect(withCount("Studio / Brand", 12, EVENTS)).toBe("Studio / Brand (12 events)");
  });

  it("reads its word from count()", () => {
    for (const n of [0, 1, 2, 21, 101]) expect(withCount("All places", n, TASKS)).toBe(`All places (${count(n, TASKS.one, TASKS.many)})`);
  });
});
