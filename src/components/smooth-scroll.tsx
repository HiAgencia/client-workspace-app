"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import "lenis/dist/lenis.css";
import { pageHeld, setSmoothScroll } from "./page-scroll";

const SMOOTH = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const OWN_SCROLL = "dialog[open], .positioner, .popup, [role='menu'], [role='listbox'], [data-lenis-prevent]";

export function SmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const wanted = window.matchMedia(SMOOTH);
    const hold = () => {
      const current = lenis.current;
      if (!current) return;
      if (pageHeld()) current.stop();
      else current.start();
    };
    const start = () => {
      if (lenis.current || !wanted.matches) return;
      lenis.current = new Lenis({
        autoRaf: true,
        lerp: 0.12,
        smoothWheel: true,
        allowNestedScroll: true,
        prevent: (node) => node instanceof Element && node.matches(OWN_SCROLL),
      });
      setSmoothScroll(lenis.current);
      hold();
    };
    const stop = () => {
      lenis.current?.destroy();
      lenis.current = null;
      setSmoothScroll(null);
    };
    const follow = () => (wanted.matches ? start() : stop());
    const layers = new MutationObserver(hold);
    layers.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "data-open"] });
    follow();
    wanted.addEventListener("change", follow);
    return () => {
      layers.disconnect();
      wanted.removeEventListener("change", follow);
      stop();
    };
  }, []);

  useEffect(() => {
    const current = lenis.current;
    if (!current) return;
    current.stop();
    if (!pageHeld()) current.start();
  }, [pathname]);

  return null;
}
