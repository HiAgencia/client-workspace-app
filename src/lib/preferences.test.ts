import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, layoutCookie, preferencesChange, readLayoutCookie, type Preferences } from "./preferences";
import { sessionOwner } from "./supabase/session-owner";

const NODE = "node:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("the layout cookie", () => {
  it("carries each page's boxes and layout and reads back the same", () => {
    const preferences: Preferences = {
      ...DEFAULT_PREFERENCES,
      boards: { overview: { order: ["tasks", "calendar", "mail"], hidden: ["activity"] }, [NODE]: { order: ["notes", "tasks"], hidden: [] } },
      layouts: { tasks: "board", [NODE]: "list" },
    };
    expect(readLayoutCookie(layoutCookie(preferences))).toEqual({ boards: preferences.boards, layouts: preferences.layouts });
  });

  it("keeps the page just written and stays within what one cookie holds, leaving out the pages that do not fit", () => {
    const boards: Preferences["boards"] = {};
    for (let i = 0; i < 200; i++) {
      boards[`node:${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`] = { order: ["tasks", "calendar", "mail", "notes", "subprojects"], hidden: [] };
    }
    const last = Object.keys(boards).at(-1)!;
    const value = layoutCookie({ ...DEFAULT_PREFERENCES, boards }, last);
    expect(value.length).toBeLessThanOrEqual(3500);
    const read = readLayoutCookie(value);
    expect(read.boards[last]).toEqual(boards[last]);
    expect(Object.keys(read.boards).length).toBeLessThan(200);
  });

  it("reads nothing from a cookie that does not read, and drops what does not belong", () => {
    expect(readLayoutCookie(undefined)).toEqual({ boards: {}, layouts: {} });
    expect(readLayoutCookie("%7Bnot json")).toEqual({ boards: {}, layouts: {} });
    const forged = encodeURIComponent(JSON.stringify({ "../admin": { l: "board" }, tasks: { l: "grid" }, overview: { b: { order: ["Tasks!"] } } }));
    expect(readLayoutCookie(forged)).toEqual({ boards: {}, layouts: {} });
  });
});

describe("the layout cookie's owner", () => {
  const ME = "11111111-1111-4111-8111-111111111111";
  const SOMEONE = "22222222-2222-4222-8222-222222222222";
  const preferences: Preferences = { ...DEFAULT_PREFERENCES, layouts: { tasks: "board" } };

  it("is read only by the person it names", () => {
    const value = layoutCookie(preferences, "tasks", ME);
    expect(readLayoutCookie(value, ME).layouts).toEqual({ tasks: "board" });
    expect(readLayoutCookie(value, SOMEONE)).toEqual({ boards: {}, layouts: {} });
    expect(readLayoutCookie(value, null)).toEqual({ boards: {}, layouts: {} });
    // A cookie written before it named its owner reads as no one's.
    expect(readLayoutCookie(layoutCookie(preferences, "tasks"), ME)).toEqual({ boards: {}, layouts: {} });
  });

  it("comes from the session cookie, whole or in chunks, plain or in base64url", () => {
    const session = JSON.stringify({ access_token: "a.b.c", user: { id: ME } });
    const encoded = `base64-${btoa(session).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    expect(sessionOwner([{ name: "sb-abcdef-auth-token", value: encodeURIComponent(session) }])).toBe(ME);
    expect(sessionOwner([{ name: "sb-abcdef-auth-token", value: encoded }])).toBe(ME);
    const half = Math.ceil(encoded.length / 2);
    expect(
      sessionOwner([
        { name: "sb-abcdef-auth-token.1", value: encoded.slice(half) },
        { name: "sb-abcdef-auth-token.0", value: encoded.slice(0, half) },
      ]),
    ).toBe(ME);
    expect(sessionOwner([{ name: "cw_layout", value: "x" }])).toBeNull();
    expect(sessionOwner([{ name: "sb-abcdef-auth-token", value: "base64-not json" }])).toBeNull();
  });
});

describe("a preferences change", () => {
  it("names the page of its boxes or layout, and changes something", () => {
    expect(preferencesChange.safeParse({ layout: "board" }).success).toBe(false);
    expect(preferencesChange.safeParse({ page: "tasks" }).success).toBe(false);
    expect(preferencesChange.safeParse({ page: "tasks", layout: "board" }).success).toBe(true);
    expect(preferencesChange.safeParse({ page: NODE, board: { order: ["tasks"] } }).success).toBe(true);
    expect(preferencesChange.safeParse({ page: "settings", layout: "board" }).success).toBe(false);
    expect(preferencesChange.safeParse({ page: "tasks", layout: "board", extra: 1 }).success).toBe(false);
  });
});
