import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";
import { BROWSER_BAR, MANIFEST_BACKGROUND } from "@/lib/theme";
import { webManifest } from "../../scripts/icons.mjs";

describe("the web manifest", () => {
  const value: ReturnType<typeof webManifest> = JSON.parse(readFileSync(new URL("../../public/manifest.webmanifest", import.meta.url), "utf8"));

  it("is what the name and the theme say today", () => {
    expect(value).toEqual(webManifest());
  });

  it("names the site, where it starts, and the theme's colors", () => {
    expect(PRODUCT_NAME).toBe("Brief");
    expect(value.name).toBe(PRODUCT_NAME);
    expect(value.short_name).toBe(PRODUCT_NAME);
    expect(value.description).toBe(PRODUCT_DESCRIPTION);
    expect(value.start_url).toBe("/");
    expect(value.background_color).toBe(MANIFEST_BACKGROUND);
    expect(value.theme_color).toBe(BROWSER_BAR.light);
  });

  it("names an installable icon set, the maskable one apart, each written on disk", () => {
    const sizes = value.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
    expect(sizes).toContain("192x192:any");
    expect(sizes).toContain("512x512:any");
    expect(sizes).toContain("512x512:maskable");
    for (const icon of value.icons) expect(existsSync(new URL(`../../public${icon.src}`, import.meta.url)), icon.src).toBe(true);
  });
});
