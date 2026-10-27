// The person's theme: stored in the browser and applied on the root before the first paint (the root layout's inline
// script). The switch reads it after mounting; its look comes from the root's attribute, so hydrating changes nothing.
export const THEME_KEY = "client-workspace:theme";

export type Theme = "light" | "dark";

// The color of the browser's own bar, which metadata cannot read from a CSS variable: the header's surface, `--card`
// in styles/tokens.css for each theme. `theme.test.ts` fails when the two drift apart.
export const BROWSER_BAR: Record<Theme, string> = { light: "#ffffff", dark: "#1b1e1a" };

const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// Switching cross-fades the whole page through the View Transitions API where it exists; with reduced motion or
// without the API the change is immediate.
export function setTheme(next: Theme): void {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Without storage the choice holds for this visit.
    }
    listeners.forEach((listener) => listener());
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") return apply();
  root.classList.add("theme-shift");
  const transition = document.startViewTransition(apply);
  void transition.finished.finally(() => root.classList.remove("theme-shift"));
}
