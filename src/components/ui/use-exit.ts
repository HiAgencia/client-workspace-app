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




export function focusAfterClose(target: () => HTMLElement | null | undefined): void {
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



export function useExit(open: boolean, element: RefObject<Element | null>): boolean {
  const [held, setHeld] = useState(open);
  if (open && !held) setHeld(true);
  useEffect(() => {
    if (open || !held) return;
    return afterExit(element.current, () => setHeld(false));
  }, [open, held, element]);
  return open || held;
}
