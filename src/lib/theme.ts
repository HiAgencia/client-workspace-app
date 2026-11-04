export const THEME_KEY = "client-workspace:theme";

export type Theme = "light" | "dark";

export const BROWSER_BAR: Record<Theme, string> = { light: "#ffffff", dark: "#171717" };

export const MANIFEST_BACKGROUND = "#f7f7f7";

export function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

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

export function setTheme(next: Theme): void {
  const root = document.documentElement;
  const apply = () => {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
    }
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") return apply();
  root.classList.add("theme-shift");
  const transition = document.startViewTransition(apply);
  void transition.finished.finally(() => root.classList.remove("theme-shift"));
}
