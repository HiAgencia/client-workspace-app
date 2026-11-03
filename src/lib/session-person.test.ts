import { describe, expect, it } from "vitest";
import { firstName, initialOf, NAME_MAX, nameToStore, sessionPerson } from "./session-person";

describe("who a session is to the person", () => {
  it("reads Google's name and photo as Supabase keeps them", () => {
    expect(sessionPerson({ full_name: "Alex Rivera", name: "Alex R", avatar_url: "https://lh3.googleusercontent.com/a/x=s96-c", picture: "https://other.example/p" })).toEqual({
      name: "Alex Rivera",
      googleName: "Alex Rivera",
      avatarUrl: "https://lh3.googleusercontent.com/a/x=s96-c",
    });
  });

  it("falls back to `name` and `picture` when the first keys are missing", () => {
    expect(sessionPerson({ name: "Sam Lee", picture: "https://lh3.googleusercontent.com/a/y" })).toEqual({
      name: "Sam Lee",
      googleName: "Sam Lee",
      avatarUrl: "https://lh3.googleusercontent.com/a/y",
    });
  });

  it("puts the name the person chose before Google's, and keeps Google's apart", () => {
    expect(sessionPerson({ display_name: "Alex", full_name: "Alex Rivera" })).toMatchObject({ name: "Alex", googleName: "Alex Rivera" });
  });

  it("reads an empty or blank chosen name as none, and tidies the spaces of a name", () => {
    expect(sessionPerson({ display_name: "   ", full_name: "  Alex   Rivera " }).name).toBe("Alex Rivera");
  });

  it("cuts a name past its limit", () => {
    expect(sessionPerson({ full_name: "A".repeat(NAME_MAX + 10) }).name).toHaveLength(NAME_MAX);
  });

  it("takes no photo that is not an https address", () => {
    expect(sessionPerson({ avatar_url: "http://lh3.googleusercontent.com/a/x" }).avatarUrl).toBeNull();
    expect(sessionPerson({ avatar_url: "javascript:alert(1)" }).avatarUrl).toBeNull();
    expect(sessionPerson({ avatar_url: "not a url", picture: "https://lh3.googleusercontent.com/a/z" }).avatarUrl).toBe("https://lh3.googleusercontent.com/a/z");
  });

  it("reads a session without metadata, such as the demo's, as nobody named", () => {
    expect(sessionPerson(undefined)).toEqual({ name: null, googleName: null, avatarUrl: null });
    expect(sessionPerson({ full_name: 42, avatar_url: null })).toEqual({ name: null, googleName: null, avatarUrl: null });
  });

  it("greets by the first word of the name and stands an initial for a person", () => {
    expect(firstName("Alex Rivera")).toBe("Alex");
    expect(firstName(null)).toBeNull();
    expect(initialOf("alex rivera", "alex@studio.example")).toBe("A");
    expect(initialOf(null, "sam@studio.example")).toBe("S");
    expect(initialOf(null, null)).toBe("");
  });

  it("keeps a typed name with its initial capital, and nothing for an empty one or Google's own", () => {
    expect(nameToStore("  alex  r. ", "Alex Rivera")).toBe("Alex r.");
    expect(nameToStore("Alex Rivera", "Alex Rivera")).toBeNull();
    expect(nameToStore("alex Rivera", "Alex Rivera")).toBeNull();
    expect(nameToStore("   ", "Alex Rivera")).toBeNull();
    expect(nameToStore("iOS Team", null)).toBe("iOS Team");
    expect(nameToStore("x".repeat(NAME_MAX + 5), null)).toHaveLength(NAME_MAX);
  });
});
