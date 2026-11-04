import { describe, expect, it } from "vitest";
import { holds } from "./holds";

describe("what a day holds", () => {
  it("says its events and its tasks, each with its count", () => {
    expect(holds(2, 3)).toBe("2 events and 3 tasks");
  });

  it("says only its events when it holds no task", () => {
    expect(holds(1, 0)).toBe("1 event");
  });

  it("says only its tasks when it holds no event", () => {
    expect(holds(0, 3)).toBe("3 tasks");
  });
});
