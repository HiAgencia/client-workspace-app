import { describe, expect, it } from "vitest";
import { LANGUAGE_KEY, LANGUAGE_OFFER_KEY, SPANISH_COUNTRIES, currentLanguage, storedLanguage } from "./language";

describe("the browser's language", () => {
  it("names its two keys, apart from every other choice of the browser", () => {
    expect(LANGUAGE_KEY).toBe("client-workspace:language");
    expect(LANGUAGE_OFFER_KEY).toBe("client-workspace:language-offer");
  });

  it("reads no choice as English", () => {
    expect(storedLanguage()).toBeNull();
    expect(currentLanguage()).toBe("en");
  });

  it("offers Spanish where it is the primary official language, and not from the United States", () => {
    expect(SPANISH_COUNTRIES.has("MX")).toBe(true);
    expect(SPANISH_COUNTRIES.has("PR")).toBe(true);
    expect(SPANISH_COUNTRIES.has("US")).toBe(false);
    expect(SPANISH_COUNTRIES.has("XX")).toBe(false);
  });
});
