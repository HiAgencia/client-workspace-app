import { describe, expect, it } from "vitest";
import { startedFor } from "./started";

describe("a workspace that has started", () => {
  it("is its owner's, said by the cookie with the owner's id", () => {
    expect(startedFor("person-a", "person-a")).toBe(true);
  });

  it("is nobody else's on the same browser, and nobody's without a session", () => {
    expect(startedFor("person-a", "person-b")).toBe(false);
    expect(startedFor("person-a", null)).toBe(false);
    expect(startedFor(undefined, "person-a")).toBe(false);
  });
});
