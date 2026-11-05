import { describe, expect, it } from "vitest";
import { organizationJsonLd, otherLanguagePath, pageMetadata, publicUrl } from "./seo";

describe("public metadata", () => {
  it("names each version's own URL as its canonical", () => {
    expect(publicUrl("en", "")).toBe("https://brief.hiagencia.com/");
    expect(publicUrl("es", "")).toBe("https://brief.hiagencia.com/es");
    expect(publicUrl("es", "/help")).toBe("https://brief.hiagencia.com/es/help");
    const meta = pageMetadata({ lang: "es", path: "/help", title: "Ayuda", description: "Ayuda." });
    expect(meta.alternates?.canonical).toBe("https://brief.hiagencia.com/es/help");
    expect(meta.alternates?.languages).toEqual({
      en: "https://brief.hiagencia.com/help",
      es: "https://brief.hiagencia.com/es/help",
      "x-default": "https://brief.hiagencia.com/help",
    });
    expect(meta.openGraph?.url).toBe("https://brief.hiagencia.com/es/help");
  });

  it("pairs each page with its other version", () => {
    expect(otherLanguagePath("en", "/terms")).toBe("/es/terms");
    expect(otherLanguagePath("es", "/terms")).toBe("/terms");
    expect(otherLanguagePath("en", "")).toBe("/es");
    expect(otherLanguagePath("es", "")).toBe("/");
  });

  it("escapes `<` in the organization and invents no address or phone", () => {
    const json = organizationJsonLd();
    expect(json).not.toContain("<");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Organization");
    expect(parsed).not.toHaveProperty("address");
    expect(parsed).not.toHaveProperty("telephone");
  });
});
