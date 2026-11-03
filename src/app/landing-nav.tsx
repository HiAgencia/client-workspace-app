"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { currentTheme, setTheme, subscribeTheme } from "@/lib/theme";




export function LandingNav({ children }: { children: ReactNode }) {
  const mark = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const node = mark.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <span ref={mark} className="landing-nav-mark" aria-hidden="true" />
      <header className="landing-nav" data-scrolled={scrolled ? "" : undefined}>
        {children}
      </header>
    </>
  );
}





export function ThemeButton({ toDark, toLight }: { toDark: ReactNode; toLight: ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => null);
  return (
    <button
      type="button"
      className="btn btn-quiet btn-icon landing-theme"
      onClick={() => setTheme(currentTheme() === "dark" ? "light" : "dark")}
      title={theme === null ? undefined : theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {toDark}
      {toLight}
      <span className="sr-only" data-to="dark">
        Switch to dark theme
      </span>
      <span className="sr-only" data-to="light">
        Switch to light theme
      </span>
    </button>
  );
}
