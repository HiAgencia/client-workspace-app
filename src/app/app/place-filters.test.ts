import { describe, expect, it } from "vitest";
import { count } from "@/lib/count";
import { accountOptions, EVENTS, MESSAGES, placeOptions, placesThatShow, TASKS, whatItBrings } from "./place-filters";



describe("what a filter's option brings", () => {
  it("says one in the singular", () => {
    expect(whatItBrings(1, TASKS)).toBe("1 task");
    expect(whatItBrings(1, MESSAGES)).toBe("1 message");
  });

  it("says none and several in the plural", () => {
    expect(whatItBrings(0, TASKS)).toBe("0 tasks");
    expect(whatItBrings(12, EVENTS)).toBe("12 events");
  });

  it("reads its word from count()", () => {
    for (const n of [0, 1, 2, 21, 101]) expect(whatItBrings(n, TASKS)).toBe(count(n, TASKS.one, TASKS.many));
  });
});

describe("the places with something to show besides their tasks", () => {
  const tree = [
    { id: "client", parentId: null },
    { id: "project", parentId: "client" },
    { id: "other", parentId: null },
  ] as Parameters<typeof placesThatShow>[0];

  it("an account shows in its node and below, a note and an own event in theirs and above, and none reads Gmail", () => {
    expect([...placesThatShow(tree, [{ nodeIds: ["client"] }], null, [])].sort()).toEqual(["client", "project"]);
    expect([...placesThatShow(tree, [], { nodes: ["client"], general: true }, [])].sort()).toEqual(["client", "general"]);
    expect([...placesThatShow(tree, [], null, [{ origin: "local", nodeId: "project", linkedNodeIds: [], fromNodeId: "" }])].sort()).toEqual(["client", "project"]);
    expect([...placesThatShow(tree, [], null, [{ origin: "local", nodeId: null, linkedNodeIds: [], fromNodeId: "" }])]).toEqual(["general"]);
    expect([...placesThatShow(tree, [], null, [])]).toEqual([]);
  });
});

describe("the place filter's options", () => {
  const tree = [
    { id: "a", path: "Larkspur Bakery", parentId: null },
    { id: "b", path: "Larkspur Bakery / Website", parentId: "a" },
    { id: "c", path: "Studio Atlas", parentId: null },
  ] as never;

  it("name what is chosen, and leave its figure to the list", () => {
    const options = placeOptions({ value: "all", tree, counts: new Map([["all", 31], ["general", 5], ["a", 8], ["b", 6]]), unit: TASKS });
    expect(options[0]).toEqual({ value: "all", label: "All places", detail: "31 tasks" });
    expect(options.every((option) => !/\d/.test(option.label))).toBe(true);
  });

  it("do not offer a place that would bring nothing, unless it is the one chosen", () => {
    const counts = new Map([["all", 8], ["a", 8]]);
    expect(placeOptions({ value: "all", tree, counts, unit: TASKS }).map((option) => option.value)).toEqual(["all", "a"]);
    expect(placeOptions({ value: "c", tree, counts, unit: TASKS }).map((option) => option.value)).toEqual(["all", "a", "c"]);
  });
});

describe("the account filter's options", () => {
  const accounts = [{ id: "x", email: "ops@example.com" }, { id: "y", email: "hello@example.com" }];

  it("name the account, and leave its figure to the list", () => {
    const options = accountOptions({ value: "all", accounts, counts: new Map([["all", 3], ["x", 3]]), unit: MESSAGES });
    expect(options).toEqual([
      { value: "all", label: "All accounts", detail: "3 messages" },
      { value: "x", label: "ops@example.com", detail: "3 messages" },
    ]);
  });

  it("are none when no account would bring anything", () => {
    expect(accountOptions({ value: "all", accounts, counts: new Map([["all", 0]]), unit: MESSAGES })).toEqual([]);
  });
});
