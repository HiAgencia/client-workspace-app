import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iconFiles } from "../../scripts/icons.mjs";



describe("the site's icons", () => {
  const drawn = iconFiles();

  it.each(Object.keys(drawn) as Array<keyof typeof drawn>)("%s matches what the mark and the accent draw today", (name) => {
    const written = readFileSync(new URL(`../app/${name}`, import.meta.url));
    expect(written.equals(drawn[name])).toBe(true);
  });
});
