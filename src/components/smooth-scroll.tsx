"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import "lenis/dist/lenis.css";







const SMOOTH = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const OWN_SCROLL = "dialog[open], .positioner, .popup, [role='menu'], [role='listbox'], [data-lenis-prevent]";

export function SmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const wanted = window.matchMedia(SMOOTH);
    const start = () => {
      if (lenis.current || !wanted.matches) return;
      lenis.current = new Lenis({
        autoRaf: true,
        lerp: 0.12,
        smoothWheel: true,
        allowNestedScroll: true,
        prevent: (node) => node instanceof Element && node.matches(OWN_SCROLL),
      });
    };
    const stop = () => {
      lenis.current?.destroy();
      lenis.current = null;
    };
    const follow = () => (wanted.matches ? start() : stop());
    follow();
    wanted.addEventListener("change", follow);
    return () => {
      wanted.removeEventListener("change", follow);
      stop();
    };
  }, []);

  
  
  useEffect(() => {
    const current = lenis.current;
    if (!current) return;
    current.stop();
    current.start();
  }, [pathname]);

  return null;
}
