import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOLDING_LAYER } from "./page-scroll";

const lockOf = (css: string) => css.match(/html:has\(([^)\n]+)\)\s*\{\s*overflow:\s*hidden/)?.[1];
const layers = (selector: string | undefined) =>
  selector
    ?.split(",")
    .map((part) => part.trim())
    .sort();
const sameLayers = (css: string) => {
  const lock = layers(lockOf(css));
  return lock !== undefined && JSON.stringify(lock) === JSON.stringify(layers(HOLDING_LAYER));
};

describe("the layers that hold the page", () => {
  const system = readFileSync(new URL("../app/styles/system.css", import.meta.url), "utf8");

  it("lock the root's scroll under the same selector the smooth scroll stops on", () => {
    expect(lockOf(system)).toBeDefined();
    expect(sameLayers(system)).toBe(true);
  });

  it("tell a lock on other layers apart", () => {
    const planted = system.replace(/html:has\([^)\n]+\)(\s*\{\s*overflow:\s*hidden)/, "html:has(dialog:modal, .popup[data-open])$1");
    expect(lockOf(planted)).toBe("dialog:modal, .popup[data-open]");
    expect(sameLayers(planted)).toBe(false);
  });
});
