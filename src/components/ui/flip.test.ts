import { describe, expect, it } from "vitest";
import { durationOf, translateOf } from "./flip";

describe("durationOf", () => {
  it("reads a role's duration in milliseconds, whichever unit it is written in", () => {
    expect(durationOf("120ms")).toBe(120);
    expect(durationOf(" 0.32s ")).toBe(320);
    expect(durationOf("200ms")).toBe(200);
  });

  it("reads anything else as no duration, so the engine does not move rather than invent a pace", () => {
    expect(durationOf("")).toBe(0);
    expect(durationOf("fast")).toBe(0);
    expect(durationOf("200")).toBe(0);
  });
});

describe("translateOf", () => {
  it("reads a computed translate in pixels, the missing axis as zero", () => {
    expect(translateOf("none", 100, 40)).toEqual([0, 0]);
    expect(translateOf("12px", 100, 40)).toEqual([12, 0]);
    expect(translateOf("12px -4.5px", 100, 40)).toEqual([12, -4.5]);
    expect(translateOf("3px 4px 0px", 100, 40)).toEqual([3, 4]);
  });

  it("takes a percentage against the piece's own size", () => {
    expect(translateOf("50% 0px", 100, 40)).toEqual([50, 0]);
    expect(translateOf("0px -25%", 100, 40)).toEqual([0, -10]);
  });

  it("reads what it cannot parse as no translate", () => {
    expect(translateOf("", 100, 40)).toEqual([0, 0]);
    expect(translateOf("calc(1px + 2%) 3px", 100, 40)).toEqual([0, 3]);
  });
});
