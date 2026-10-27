"use client";

import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeTheme } from "@/lib/theme";

// A two-state setting is a switch: the thumb travels to the chosen side and carries the state's mark. Its position comes
// from the root's theme attribute, set before the first paint; `aria-checked` follows once mounted.
export function ThemeSwitch() {
  const dark = useSyncExternalStore(subscribeTheme, () => currentTheme() === "dark", () => false);
  return (
    <button type="button" role="switch" aria-checked={dark} className="switch" onClick={() => setTheme(dark ? "light" : "dark")}>
      <span className="switch-rail" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-text">Dark theme</span>
    </button>
  );
}
