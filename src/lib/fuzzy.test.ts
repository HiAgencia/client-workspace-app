import { describe, expect, it } from "vitest";
import { editDistance, matchScore, normalize, prepare, rank } from "./fuzzy";

describe("search that forgives typing", () => {
  it("finds a name with a missing letter, a swapped pair, or a wrong one", () => {
    expect(matchScore("larkspr", "Larkspur Bakery")).toBeGreaterThan(0);
    expect(matchScore("webiste", "Website")).toBeGreaterThan(0);
    expect(matchScore("brnd refresh", "Brand refresh")).toBeGreaterThan(0);
    expect(matchScore("logo directons", "Present two logo directions")).toBeGreaterThan(0);
  });

  it("finds a word still being typed, with a typo in it", () => {
    expect(matchScore("larksp", "Larkspur Bakery")).toBeGreaterThan(0);
  });

  it("ignores accents and case, and keeps ñ as its own letter", () => {
    expect(matchScore("decision", "Décision tomada")).toBeGreaterThan(0);
    expect(normalize("Año")).toBe("año");
    expect(matchScore("ano", "Año nuevo")).toBe(0);
  });

  it("needs every typed word to match, in any order", () => {
    expect(matchScore("bakery larkspur", "Larkspur Bakery")).toBeGreaterThan(0);
    expect(matchScore("larkspur atlas", "Larkspur Bakery")).toBe(0);
  });

  it("does not match what is merely near in a short word", () => {
    expect(matchScore("web", "Wed meeting")).toBe(0);
    expect(matchScore("xyz", "Website")).toBe(0);
  });

  it("ranks the exact start above a typo", () => {
    const hits = rank("web", ["The web team", "Website"], prepare);
    expect(hits.map((h) => h.entry)).toEqual(["Website", "The web team"]);
    const typo = rank("websit", ["Website", "Wbsite draft"], prepare);
    expect(typo[0].entry).toBe("Website");
  });

  it("counts a swapped pair as one edit and stops past the limit", () => {
    expect(editDistance("webiste", "website", 2)).toBe(1);
    expect(editDistance("abcdef", "uvwxyz", 2)).toBe(3);
  });
});
