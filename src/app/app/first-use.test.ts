import { describe, expect, it } from "vitest";
import { isFirstUse } from "./first-use";

describe("the first use", () => {
  const empty = { tree: [], generalTasks: 0, notePlaces: { general: false } };

  it("is a workspace read with nothing in it", () => {
    expect(isFirstUse(empty)).toBe(true);
  });

  it("is not decided before the tree is read", () => {
    expect(isFirstUse({ ...empty, tree: null })).toBe(false);
  });

  it("ends with the first client or project", () => {
    expect(isFirstUse({ ...empty, tree: [{ id: "a" }] })).toBe(false);
  });

  it("is not a workspace that already holds a task or a note in General", () => {
    expect(isFirstUse({ ...empty, generalTasks: 1 })).toBe(false);
    expect(isFirstUse({ ...empty, notePlaces: { general: true } })).toBe(false);
  });
});
