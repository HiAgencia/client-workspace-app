import { afterEach, describe, expect, it, vi } from "vitest";
import { healthStatus } from "@/lib/health";

describe("healthStatus", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the app as up, with the simulated chat unless the server is set to Meta", () => {
    vi.stubEnv("MODEL_PROVIDER", "");
    expect(healthStatus()).toEqual({ ok: true, chat: "simulated" });
    vi.stubEnv("MODEL_PROVIDER", "simulated");
    expect(healthStatus()).toEqual({ ok: true, chat: "simulated" });
  });

  it("says when the chat answers with Meta's models, so a check that must not spend can stop", () => {
    vi.stubEnv("MODEL_PROVIDER", "meta");
    expect(healthStatus()).toEqual({ ok: true, chat: "meta" });
  });
});
