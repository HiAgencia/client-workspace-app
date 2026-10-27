import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iconFiles } from "../../scripts/icons.mjs";

// The site's icons are drawn from the mark's geometry and the accent's color: a change to either that was not followed
// by `pnpm icons` leaves the favicon showing the old mark.
describe("the site's icons", () => {
  const drawn = iconFiles();

  it.each(Object.keys(drawn) as Array<keyof typeof drawn>)("%s matches what the mark and the accent draw today", (name) => {
    const written = readFileSync(new URL(`../app/${name}`, import.meta.url));
    expect(written.equals(drawn[name])).toBe(true);
  });
});
