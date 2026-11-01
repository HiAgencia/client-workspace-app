import { afterEach, describe, expect, it, vi } from "vitest";
import { healthStatus } from "@/lib/health";

describe("healthStatus", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the app as up, with the AI off unless the server names a model, a value mistyped included", () => {
    vi.stubEnv("MODEL_PROVIDER", "");
    expect(healthStatus()).toEqual({ ok: true, chat: "off" });
    vi.stubEnv("MODEL_PROVIDER", "Meta");
    expect(healthStatus()).toEqual({ ok: true, chat: "off" });
    vi.stubEnv("MODEL_PROVIDER", "simulated");
    expect(healthStatus()).toEqual({ ok: true, chat: "simulated" });
  });

  it("says when the chat answers with Meta's models, so a check that must not spend can stop", () => {
    vi.stubEnv("MODEL_PROVIDER", "meta");
    expect(healthStatus()).toEqual({ ok: true, chat: "meta" });
  });
});
