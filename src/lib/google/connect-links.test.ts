import { describe, expect, it } from "vitest";
import { hashLinkToken, newLinkToken } from "./connect-links";
import { signLinkState, signState, verifyLinkState, verifyState } from "./state";

const SECRET = "a-secret-of-the-server-that-signs-the-state";

describe("a connect link", () => {
  it("keeps only the token's hash, and a different token hashes differently", async () => {
    const token = newLinkToken();
    const hash = await hashLinkToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(await hashLinkToken(newLinkToken())).not.toBe(hash);
    expect(await hashLinkToken(token)).toBe(hash);
  });

  it("signs a state only the link callback accepts, and only while it lives", async () => {
    const now = Date.now();
    const state = await signLinkState(SECRET, "link-1", now);
    expect((await verifyLinkState(SECRET, state, now))?.linkId).toBe("link-1");
    expect(await verifyLinkState(SECRET, state, now + 11 * 60 * 1000)).toBeNull();
    expect(await verifyLinkState("another-secret", state, now)).toBeNull();
    expect(await verifyState(SECRET, state, now)).toBeNull();
    const browser = await signState(SECRET, { nodeId: "node", userId: "user", nonce: "nonce" }, now);
    expect(await verifyLinkState(SECRET, browser, now)).toBeNull();
  });
});
