"use client";

import { useLayoutEffect, type RefObject } from "react";

// A chosen state travels: ONE piece, the host's `::before`, takes the box of the element the selector finds and moves
// there when the choice, the content, or the size changes. Boxes are read in fractional pixels against the host's
// padding box, because whole-pixel offsets leave the piece off its option at a fractional device scale. The first
// placement goes without transition (`data-piece-ready` is set two frames later).
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
      const x = box.left - outer.left - parseFloat(style.borderLeftWidth || "0") + el.scrollLeft;
      const y = box.top - outer.top - parseFloat(style.borderTopWidth || "0") + el.scrollTop;
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
      attributeFilter: ["aria-current", "aria-selected", "aria-pressed", "hidden", "data-open"],
    });
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
    };
  }, [host, selector]);
}
