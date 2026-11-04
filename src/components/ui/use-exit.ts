"use client";

import { useEffect, useState, type RefObject } from "react";

type Leaving = Element | null | undefined;

export function afterExit(elements: Leaving | Leaving[], done: () => void): () => void {
  let live = true;
  const running = [elements]
    .flat()
    .filter((element): element is Element => Boolean(element?.isConnected))
    .flatMap((element) => element.getAnimations());
  void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
    if (live) done();
  });
  return () => {
    live = false;
  };
}

export function focusAfterClose(target: () => HTMLElement | null | undefined, from?: HTMLElement | null): void {
  const here = document.activeElement;
  if (from !== undefined && here && here !== document.body && here !== from && !here.closest("dialog:not([open])")) return;
  let acted = false;
  const act = () => {
    acted = true;
  };
  window.addEventListener("keydown", act, { capture: true, once: true });
  window.addEventListener("pointerdown", act, { capture: true, once: true });
  requestAnimationFrame(() => {
    window.removeEventListener("keydown", act, { capture: true });
    window.removeEventListener("pointerdown", act, { capture: true });
    if (!acted) target()?.focus({ preventScroll: true });
  });
}

export function takesFocus(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element !== document.body && element.isConnected && !element.closest("dialog:not([open])") && element.getClientRects().length > 0;
}

export function handBack(opener: HTMLElement | null | undefined, instead: () => HTMLElement | null | undefined): () => HTMLElement | null {
  return () => {
    if (takesFocus(opener)) return opener;
    const here = document.activeElement;
    if (here && here !== document.body && !here.closest("dialog:not([open])")) return null;
    const other = instead();
    return takesFocus(other) ? other : null;
  };
}

export function useExit(open: boolean, element: RefObject<Element | null>): boolean {
  const [held, setHeld] = useState(open);
  if (open && !held) setHeld(true);
  useEffect(() => {
    if (open || !held) return;
    return afterExit(element.current, () => setHeld(false));
  }, [open, held, element]);
  return open || held;
}
