import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BROWSER_BAR, MANIFEST_BACKGROUND } from "./theme";

// The browser's bar takes the header's surface: the literal colors the inline script and `applyTheme` need follow
// `--card` of each theme.
describe("the browser's bar color", () => {
  const tokens = readFileSync(new URL("../app/styles/tokens.css", import.meta.url), "utf8");
  const card = (block: string) => block.match(/--card:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase();
  const [light, dark] = tokens.split(':root[data-theme="dark"]');

  it("follows the card's surface in each theme", () => {
    expect(BROWSER_BAR.light).toBe(card(light));
    expect(BROWSER_BAR.dark).toBe(card(dark));
  });

  it("the manifest background follows the light theme's canvas", () => {
    expect(MANIFEST_BACKGROUND).toBe(light.match(/--canvas:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase());
  });
});
