import { describe, expect, it } from "vitest";
import { sessionCookieUser, sessionOwner } from "./session-owner";

const encoded = (session: object) => `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

describe("whose a session cookie is", () => {
  it("reads the owner and whether it is the demo's, from a whole cookie in base64", () => {
    const cookies = [{ name: "sb-project-auth-token", value: encoded({ user: { id: "person-a", is_anonymous: true } }) }];
    expect(sessionCookieUser(cookies)).toEqual({ id: "person-a", isAnonymous: true });
    expect(sessionOwner(cookies)).toBe("person-a");
  });

  it("joins a session cut in numbered chunks, in their order", () => {
    const value = encoded({ user: { id: "person-b", is_anonymous: false } });
    const cut = Math.floor(value.length / 2);
    const cookies = [
      { name: "sb-project-auth-token.1", value: value.slice(cut) },
      { name: "other", value: "1" },
      { name: "sb-project-auth-token.0", value: value.slice(0, cut) },
    ];
    expect(sessionCookieUser(cookies)).toEqual({ id: "person-b", isAnonymous: false });
  });

  it("reads plain JSON, and a session with no flag as not anonymous", () => {
    expect(sessionCookieUser([{ name: "sb-project-auth-token", value: encodeURIComponent(JSON.stringify({ user: { id: "person-c" } })) }])).toEqual({ id: "person-c", isAnonymous: false });
  });

  it("says nobody without a session cookie or with one it cannot read", () => {
    expect(sessionCookieUser([{ name: "other", value: "1" }])).toBeNull();
    expect(sessionCookieUser([{ name: "sb-project-auth-token", value: "base64-not json" }])).toBeNull();
  });
});
