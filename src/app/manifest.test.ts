import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BROWSER_BAR, MANIFEST_BACKGROUND } from "@/lib/theme";
import manifest from "./manifest";

// The manifest a system installs the site from: its name, its start, its colors from the theme, and every icon it
// names written on disk by `pnpm icons`.
describe("the web manifest", () => {
  const value = manifest();

  it("names the site, where it starts, and the theme's colors", () => {
    expect(value.name).toBe("client-workspace");
    expect(value.start_url).toBe("/");
    expect(value.background_color).toBe(MANIFEST_BACKGROUND);
    expect(value.theme_color).toBe(BROWSER_BAR.light);
  });

  it("names an installable icon set, the maskable one apart, each written on disk", () => {
    const sizes = value.icons?.map((icon) => `${icon.sizes}:${icon.purpose}`) ?? [];
    expect(sizes).toContain("192x192:any");
    expect(sizes).toContain("512x512:any");
    expect(sizes).toContain("512x512:maskable");
    for (const icon of value.icons ?? []) {
      if (icon.src.endsWith(".svg")) continue;
      expect(existsSync(new URL(`../../public${icon.src}`, import.meta.url)), icon.src).toBe(true);
    }
  });
});
