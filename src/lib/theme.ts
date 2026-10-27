

export const THEME_KEY = "client-workspace:theme";

export type Theme = "light" | "dark";



export const BROWSER_BAR: Record<Theme, string> = { light: "#ffffff", dark: "#1b1e1a" };

const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}



export function setTheme(next: Theme): void {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      
    }
    listeners.forEach((listener) => listener());
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") return apply();
  root.classList.add("theme-shift");
  const transition = document.startViewTransition(apply);
  void transition.finished.finally(() => root.classList.remove("theme-shift"));
}
