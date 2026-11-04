"use client";

import type { MouseEvent } from "react";
import { scrollPageTo, scrollPlaceIntoView } from "@/components/page-scroll";
import type { Item } from "./client-api";




export type FocusTarget =
  | { kind: "node"; nodeId: string }

  | { kind: "item"; nodeId: string; itemId: string; title: string; type: Item["type"]; done?: boolean };

export type FocusRequest = { target: FocusTarget; acted: boolean };

const EVENT = "client-workspace:focus";
let pending: FocusRequest | null = null;



function markActed() {
  if (pending) pending.acted = true;
}

export function requestFocus(target: FocusTarget): void {
  pending = { target, acted: false };
  window.addEventListener("keydown", markActed, { capture: true, once: true });
  window.addEventListener("pointerdown", markActed, { capture: true, once: true });
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function takeFocusRequest(nodeId: string): FocusRequest | null {
  if (!pending || pending.target.nodeId !== nodeId) return null;
  const request = pending;
  pending = null;
  return request;
}



export function dropFocusRequestOutside(pathname: string): void {
  if (pending && pathname !== `/app/node/${pending.target.nodeId}`) pending = null;
}



export function hasFocusRequest(pathname: string): boolean {
  return pending !== null && pathname === `/app/node/${pending.target.nodeId}`;
}

export function onFocusRequest(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}



export function plainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

export type Landing = "landed" | "busy" | "missing" | "hidden";

const nextFrame = () => new Promise((done) => requestAnimationFrame(done));


function closedAround(element: HTMLElement): HTMLElement | null {
  const fold = element.closest<HTMLElement>('.fold[data-open="false"]');
  if (fold) return fold;
  const rows = element.closest<HTMLElement>('.first-rows[data-open="false"]');
  return rows && !element.checkVisibility({ visibilityProperty: true }) ? rows : null;
}





export async function land(target: FocusTarget, { acted = false }: { acted?: boolean } = {}): Promise<Landing> {
  const active = document.activeElement as HTMLElement | null;
  const inUse =
    active !== null &&
    active !== document.body &&
    (active.matches("input, textarea, [contenteditable='true'], [role='combobox'], [role='option']") || active.closest("dialog[open], [role='listbox']") !== null);
  if (acted && inUse) return "busy";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let element: HTMLElement | null = null;
  if (target.kind === "node") element = document.querySelector<HTMLElement>("[data-node-title]");
  if (target.kind === "item") element = document.querySelector<HTMLElement>(`[data-item="${target.itemId}"] [data-item-title]`);
  if (!element) return "missing";
  const closed = closedAround(element);
  if (closed) {
    document.querySelector<HTMLElement>(`[aria-controls="${closed.id}"]`)?.click();
    for (let frames = 0; closed.dataset.open !== "true" && frames < 10; frames++) await nextFrame();
  }
  element.focus({ preventScroll: true });
  if (document.activeElement !== element) return "hidden";
  
  if (closed) await Promise.allSettled([closed, element.closest<HTMLElement>(".task-item")].flatMap((box) => box?.getAnimations() ?? []).map((animation) => animation.finished));
  
  
  if (target.kind === "node") scrollPageTo(0, reduced);
  else scrollPlaceIntoView(element, "center", reduced);
  if (target.kind === "item") {
    const row = element.closest<HTMLElement>("[data-item]");
    if (row && !reduced) {
      row.removeAttribute("data-changed");
      void row.offsetWidth;
      row.setAttribute("data-changed", "");
    }
  }
  return "landed";
}
