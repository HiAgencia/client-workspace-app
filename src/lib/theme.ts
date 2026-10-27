// The person's theme: stored in the browser and applied on the root before the first paint by the root layout's inline
// script, which also follows the system while there is no choice and follows a choice made in another tab. The switch
// reads the root's attribute, so whatever changes it, the switch follows.
export const THEME_KEY = "client-workspace:theme";

export type Theme = "light" | "dark";

// The color of the browser's own bar, read by the root layout's inline script before the first paint and by
// `applyTheme`: the literal is needed because a meta tag cannot read a CSS variable. `theme.test.ts` fails when it
// drifts from `--card` in styles/tokens.css.
export const BROWSER_BAR: Record<Theme, string> = { light: "#ffffff", dark: "#1b1e1a" };

// The web manifest's background: `--canvas` of the light theme in styles/tokens.css, the surface a system paints
// behind the maskable icon's mark. `theme.test.ts` fails when the two drift apart.
export const MANIFEST_BACKGROUND = "#eff1ec";

export function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// The root's theme and the browser bar's color, together: the bar shows the chosen theme, not the system's.
export function applyTheme(next: Theme): void {
  document.documentElement.dataset.theme = next;
  let bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!bar) {
    bar = document.createElement("meta");
    bar.name = "theme-color";
    document.head.append(bar);
  }
  bar.content = BROWSER_BAR[next];
}

// Switching cross-fades the whole page through the View Transitions API where it exists; with reduced motion or
// without the API the change is immediate.
export function setTheme(next: Theme): void {
  const root = document.documentElement;
  const apply = () => {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Without storage the choice holds for this visit.
    }
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") return apply();
  root.classList.add("theme-shift");
  const transition = document.startViewTransition(apply);
  void transition.finished.finally(() => root.classList.remove("theme-shift"));
}
