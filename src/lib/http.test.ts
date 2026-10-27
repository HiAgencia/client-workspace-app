import { describe, expect, it } from "vitest";
import { safeNext } from "./http";

const origin = "http://localhost:8787";

describe("where to land after signing in", () => {
  it("keeps a path on this site with its query", () => {
    expect(safeNext("/app/node/x?google=connected", origin)).toBe("/app/node/x?google=connected");
  });

  it("refuses every way to another host", () => {
    for (const value of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com/app", "javascript:alert(1)"]) {
      expect(safeNext(value, origin)).toBe("/");
    }
  });

  it("falls back to the start without a value", () => {
    expect(safeNext(null, origin)).toBe("/");
  });
});
