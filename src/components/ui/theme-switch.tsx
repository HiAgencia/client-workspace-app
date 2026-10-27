"use client";

import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeTheme } from "@/lib/theme";



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
