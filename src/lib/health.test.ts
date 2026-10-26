import { describe, expect, it } from "vitest";
import { healthStatus } from "@/lib/health";

describe("healthStatus", () => {
  it("reports the app as up", () => {
    expect(healthStatus()).toEqual({ ok: true });
  });
});
