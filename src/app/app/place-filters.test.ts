import { describe, expect, it } from "vitest";
import { count } from "@/lib/count";
import { accountFromUrl, accountOptions, chosenAccounts, countsByAccount, EVENTS, MESSAGES, placeOptions, placesThatShow, TASKS, whatItBrings } from "./place-filters";

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
    expect(options[0]).toEqual({ value: "all", label: "All clients and projects", detail: "31 tasks" });
    expect(options.every((option) => !/\d/.test(option.label))).toBe(true);
  });

  it("do not offer a place that would bring nothing, unless it is the one chosen", () => {
    const counts = new Map([["all", 8], ["a", 8]]);
    expect(placeOptions({ value: "all", tree, counts, unit: TASKS }).map((option) => option.value)).toEqual(["all", "a"]);
    expect(placeOptions({ value: "c", tree, counts, unit: TASKS }).map((option) => option.value)).toEqual(["all", "a", "c"]);
  });
});

describe("the account filter's options", () => {
  const tree = [
    { id: "bakery", parentId: null, name: "Bakery", color: "amber" },
    { id: "site", parentId: "bakery", name: "Website", color: "amber" },
    { id: "studio", parentId: null, name: "Studio", color: "blue" },
  ] as Parameters<typeof accountOptions>[0]["tree"];
  const accounts = [
    { id: "x", email: "hello@bakery.example", nodeIds: ["bakery"] },
    { id: "y", email: "orders@bakery.example", nodeIds: ["site"] },
    { id: "z", email: "studio@studio.example", nodeIds: ["studio"] },
    { id: "w", email: "me@example.com", nodeIds: [] },
  ];
  const counts = new Map([["all", 9], ["of:bakery", 5], ["of:studio", 4], ["x", 3], ["y", 2], ["z", 4], ["w", 0]]);

  it("offer every account under its client, the client's accounts together first, and those connected nowhere last", () => {
    const options = accountOptions({ value: "all", accounts, tree, counts, unit: MESSAGES });
    expect(options.map((option) => [option.value, option.label, option.group?.label ?? null])).toEqual([
      ["all", "All accounts", null],
      ["of:bakery", "All Bakery accounts", "Bakery"],
      ["x", "hello@bakery.example", "Bakery"],
      ["y", "orders@bakery.example", "Bakery"],
      ["z", "studio@studio.example", "Studio"],
      ["w", "me@example.com", "No client or project"],
    ]);
  });

  it("say what each brings, and offer one that brings nothing, quieter", () => {
    const options = accountOptions({ value: "all", accounts, tree, counts, unit: MESSAGES });
    expect(options.find((option) => option.value === "x")).toMatchObject({ detail: "3 messages", empty: false });
    expect(options.find((option) => option.value === "w")).toMatchObject({ detail: "0 messages", empty: true });
  });

  it("say no figure while what they bring is not known", () => {
    const options = accountOptions({ value: "all", accounts, tree, counts: null, unit: MESSAGES });
    expect(options.every((option) => option.detail === undefined)).toBe(true);
  });

  it("list an account connected under two clients under the one it is connected to most directly", () => {
    const shared = [...accounts.slice(0, 3), { id: "v", email: "shared@example.com", nodeIds: ["site", "studio"] }];
    const options = accountOptions({ value: "all", accounts: shared, tree, counts, unit: MESSAGES });
    expect(options.find((option) => option.value === "v")?.group?.label).toBe("Studio");
    expect(options.find((option) => option.value === "of:studio")?.label).toBe("All Studio accounts");
  });

  it("order the clients as the sidebar does: the clients first, then the projects that stand on their own", () => {
    const mixed = [
      { id: "ops", parentId: null, kind: "project", name: "Operations", color: null },
      { id: "acme", parentId: null, kind: "client", name: "Acme", color: null },
    ] as Parameters<typeof accountOptions>[0]["tree"];
    const own = [
      { id: "a", email: "ops@example.com", nodeIds: ["ops"] },
      { id: "b", email: "acme@example.com", nodeIds: ["acme"] },
    ];
    const options = accountOptions({ value: "all", accounts: own, tree: mixed, counts: null, unit: MESSAGES });
    expect(options.map((option) => option.group?.label ?? null)).toEqual([null, "Acme", "Operations"]);
  });

  it("draw no heading, and no client's «all», when every account is under one client", () => {
    const options = accountOptions({ value: "all", accounts: accounts.slice(0, 2), tree, counts, unit: MESSAGES });
    expect(options.map((option) => [option.value, option.group ?? null])).toEqual([
      ["all", null],
      ["x", null],
      ["y", null],
    ]);
  });

  it("are none when there is no account", () => {
    expect(accountOptions({ value: "all", accounts: [], tree, counts, unit: MESSAGES })).toEqual([]);
  });
});

describe("what the account filter leaves", () => {
  const tree = [
    { id: "bakery", parentId: null },
    { id: "site", parentId: "bakery" },
    { id: "studio", parentId: null },
  ] as Parameters<typeof chosenAccounts>[2];
  const accounts = [
    { id: "x", email: "a@example.com", nodeIds: ["bakery"] },
    { id: "y", email: "b@example.com", nodeIds: ["site"] },
    { id: "z", email: "c@example.com", nodeIds: ["studio"] },
  ];

  it("is every account, a client's accounts anywhere under it, or one account", () => {
    expect(chosenAccounts("all", accounts, tree)).toBeNull();
    expect(chosenAccounts(null, accounts, tree)).toBeNull();
    expect([...chosenAccounts("of:bakery", accounts, tree)!].sort()).toEqual(["x", "y"]);
    expect([...chosenAccounts("z", accounts, tree)!]).toEqual(["z"]);
  });

  it("drops what the address names and no longer exists", () => {
    expect(accountFromUrl("gone", accounts, tree)).toBe("all");
    expect(accountFromUrl("of:site", accounts, tree)).toBe("all");
    expect(accountFromUrl("of:nowhere", accounts, tree)).toBe("all");
    expect(accountFromUrl("of:bakery", accounts, tree)).toBe("of:bakery");
    expect(accountFromUrl("y", accounts, tree)).toBe("y");
  });

  it("counts each option from what the page counts for its accounts", () => {
    const counted = countsByAccount(accounts, tree, (some) => (some === null ? 3 : some.size));
    expect(Object.fromEntries(counted)).toEqual({ all: 3, "of:bakery": 2, "of:studio": 1, x: 1, y: 1, z: 1 });
  });
});
