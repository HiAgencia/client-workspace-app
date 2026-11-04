"use client";

import { useLayoutEffect, type RefObject } from "react";

export function usePiece(host: RefObject<HTMLElement | null>, selector: string): void {
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      const active = el.querySelector<HTMLElement>(selector);
      if (!active || active.getClientRects().length === 0) {
        el.style.setProperty("--piece-on", "0");
        return;
      }
      const outer = el.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      const style = getComputedStyle(el);
      const { dx, dy } = moved(active, el);
      const x = box.left - dx - outer.left - parseFloat(style.borderLeftWidth || "0") + el.scrollLeft;
      const y = box.top - dy - outer.top - parseFloat(style.borderTopWidth || "0") + el.scrollTop;
      el.style.setProperty("--piece-x", `${x}px`);
      el.style.setProperty("--piece-y", `${y}px`);
      el.style.setProperty("--piece-w", `${box.width}px`);
      el.style.setProperty("--piece-h", `${box.height}px`);
      el.style.setProperty("--piece-on", "1");
      if (!el.hasAttribute("data-piece-ready")) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => el.setAttribute("data-piece-ready", ""))));
      }
    };
    place();
    const sizes = new ResizeObserver(place);
    sizes.observe(el);
    const changes = new MutationObserver(place);
    changes.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-current", "aria-pressed", "hidden", "data-open"],
    });
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
    };
  }, [host, selector]);
}

function moved(active: HTMLElement, host: HTMLElement): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  for (let at: HTMLElement | null = active; at && at !== host; at = at.parentElement) {
    const value = getComputedStyle(at).translate;
    if (!value || value === "none") continue;
    const [x = "0", y = "0"] = value.split(/\s+/);
    dx += length(x, at.offsetWidth);
    dy += length(y, at.offsetHeight);
  }
  return { dx, dy };
}

function length(value: string, box: number): number {
  const number = parseFloat(value) || 0;
  return value.endsWith("%") ? (number / 100) * box : number;
}
