"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type Follow = { drawn: boolean; height: number; running: Animation | null };

export function useAutoHeight(box: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, { ready = true, trigger }: { ready?: boolean; trigger?: unknown } = {}): void {
  const state = useRef<Follow | null>(null);
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = content.current;
    if (!ready || !outer || !inner) return;
    const follow: Follow = { ...measure(outer), running: null };
    state.current = follow;
    const observer = new ResizeObserver(() => travel(outer, follow));
    observer.observe(inner);
    return () => {
      observer.disconnect();
      follow.running?.cancel();
      state.current = null;
    };
  }, [box, content, ready]);
  useLayoutEffect(() => {
    if (box.current && state.current) travel(box.current, state.current);
  }, [box, trigger]);
}

function measure(outer: HTMLElement): { drawn: boolean; height: number } {
  const drawn = outer.getClientRects().length > 0;
  return { drawn, height: drawn ? outer.offsetHeight : 0 };
}

function travel(outer: HTMLElement, follow: Follow): void {
  const wasDrawn = follow.drawn;
  const moving = follow.running !== null && follow.running.playState === "running";
  const from = moving ? parseFloat(getComputedStyle(outer).height) : follow.height;
  follow.running?.cancel();
  follow.running = null;
  const now = measure(outer);
  follow.drawn = now.drawn;
  follow.height = now.height;
  if (!wasDrawn || !now.drawn || Math.abs(from - now.height) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = getComputedStyle(document.documentElement);
  const clip = getComputedStyle(outer).overflowY === "visible" ? { overflow: "clip" } : {};
  const animation = outer.animate([{ height: `${from}px`, ...clip }, { height: `${now.height}px`, ...clip }], {
    duration: milliseconds(root.getPropertyValue("--dur")),
    easing: root.getPropertyValue("--ease-std").trim() || "ease",
  });
  animation.onfinish = () => {
    if (follow.running === animation) follow.running = null;
  };
  follow.running = animation;
}

function milliseconds(value: string): number {
  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  return value.trim().endsWith("ms") ? amount : amount * 1000;
}
