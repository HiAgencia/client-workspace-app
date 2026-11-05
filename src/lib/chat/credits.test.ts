import type { LanguageModelUsage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { creditCapMicroUsd, stepCost, transcriptionCost, UNREPORTED_STEP } from "./credits";

const usage = (input: number | undefined, output: number | undefined, cached?: number): LanguageModelUsage =>
  ({ inputTokens: input, outputTokens: output, inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: cached, cacheWriteTokens: undefined } }) as LanguageModelUsage;

describe("the AI's credits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prices a step at the published rates, rounded up", () => {
    expect(stepCost(usage(1000, 200))).toBe(2100);
    expect(stepCost(usage(1, 0))).toBe(2);
    expect(stepCost(usage(3, 1))).toBe(8);
    expect(stepCost(usage(3, 2))).toBe(13);
  });

  it("prices cached input at the cached rate, and never more cached than input", () => {
    expect(stepCost(usage(1000, 0, 800))).toBe(Math.ceil(200 * 1.25 + 800 * 0.15));
    expect(stepCost(usage(100, 0, 500))).toBe(Math.ceil(100 * 0.15));
  });

  it("charges a step with no reported usage as a long one", () => {
    expect(stepCost(undefined)).toBe(UNREPORTED_STEP);
    expect(stepCost(usage(undefined, undefined))).toBe(UNREPORTED_STEP);
  });

  it("charges dictation by the minute begun", () => {
    expect(transcriptionCost(0)).toBe(3000);
    expect(transcriptionCost(59.9)).toBe(3000);
    expect(transcriptionCost(60.1)).toBe(6000);
  });

  it("caps the server's key at 125 dollars unless the deployment sets another", () => {
    expect(creditCapMicroUsd()).toBe(125_000_000);
    vi.stubEnv("AI_CREDIT_CAP_USD", "40.5");
    expect(creditCapMicroUsd()).toBe(40_500_000);
    vi.stubEnv("AI_CREDIT_CAP_USD", "nope");
    expect(creditCapMicroUsd()).toBe(125_000_000);
  });
});
