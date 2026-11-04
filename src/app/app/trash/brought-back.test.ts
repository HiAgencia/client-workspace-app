import { describe, expect, it } from "vitest";
import { broughtBack } from "./brought-back";

describe("what a restore brings back", () => {
  it("says nothing for an item deleted alone", () => {
    expect(broughtBack({ subtasks: 0, notes: 0, decisions: 0 })).toBeNull();
  });

  it("says one kind with its count, in the singular or the plural", () => {
    expect(broughtBack({ subtasks: 1, notes: 0, decisions: 0 })).toBe("1 subtask");
    expect(broughtBack({ subtasks: 0, notes: 3, decisions: 0 })).toBe("3 notes");
    expect(broughtBack({ subtasks: 0, notes: 0, decisions: 2 })).toBe("2 decisions");
  });

  it("joins two kinds with «and»", () => {
    expect(broughtBack({ subtasks: 2, notes: 1, decisions: 0 })).toBe("2 subtasks and 1 note");
    expect(broughtBack({ subtasks: 0, notes: 1, decisions: 1 })).toBe("1 note and 1 decision");
  });

  it("joins three kinds with a comma and then «and»", () => {
    expect(broughtBack({ subtasks: 2, notes: 1, decisions: 1 })).toBe("2 subtasks, 1 note and 1 decision");
  });

  it("counts decisions apart from notes", () => {
    expect(broughtBack({ subtasks: 0, notes: 0, decisions: 1 })).not.toContain("note");
  });
});
