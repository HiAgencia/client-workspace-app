import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iconFiles, logoFiles, manifestIconFiles } from "../../scripts/icons.mjs";

describe("the site's icons", () => {
  const drawn = iconFiles();

  it.each(Object.keys(drawn) as Array<keyof typeof drawn>)("%s matches what the mark and the accent draw today", (name) => {
    const written = readFileSync(new URL(`../../public/${name}`, import.meta.url));
    expect(written.equals(drawn[name])).toBe(true);
  });

  const manifestDrawn = manifestIconFiles();
  it.each(Object.keys(manifestDrawn) as Array<keyof typeof manifestDrawn>)(
    "manifest icon %s matches what the mark and the accent draw today",
    (name) => {
      const written = readFileSync(new URL(`../../public/${name}`, import.meta.url));
      expect(written.equals(manifestDrawn[name])).toBe(true);
    },
  );

  const logosDrawn = logoFiles();
  it.each(Object.keys(logosDrawn) as Array<keyof typeof logosDrawn>)("logo %s matches what the mark draws today", (name) => {
    const written = readFileSync(new URL(`../../public/${name}`, import.meta.url));
    expect(written.equals(logosDrawn[name])).toBe(true);
  });
});
