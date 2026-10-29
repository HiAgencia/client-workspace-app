"use client";

import type { MouseEvent } from "react";
import type { Item } from "./client-api";

// Where the palette, the tree, or a row's path sends the person: a node's title, one item's row, or a quick add. The
// request waits until the node that holds the place has its data on screen, then the view goes there and the focus
// lands on it.
export type FocusTarget =
  | { kind: "node"; nodeId: string }
  // A done task or a reviewed item lives behind its section's other tab: `done` says so.
  | { kind: "item"; nodeId: string; itemId: string; title: string; type: Item["type"]; done?: boolean }
  | { kind: "quick-add"; nodeId: string; type: Item["type"] };

export type FocusRequest = { target: FocusTarget; acted: boolean };

const EVENT = "client-workspace:focus";
let pending: FocusRequest | null = null;

// A key or a press of the person's own after the request means they moved on. The focus a closing dialog hands back to
// where it was is not theirs, so it does not count.
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

// A request for a node the person did not reach —they went somewhere else first— is dropped, so it never lands later on
// a visit that did not ask for it.
export function dropFocusRequestOutside(pathname: string): void {
  if (pending && pathname !== `/app/node/${pending.target.nodeId}`) pending = null;
}

// Whether a landing is waiting for this address: the shell leaves the focus alone when the person asked for a place
// inside the page that is arriving, and `land()` puts it there once its data is on screen.
export function hasFocusRequest(pathname: string): boolean {
  return pending !== null && pathname === `/app/node/${pending.target.nodeId}`;
}

export function onFocusRequest(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

// A link that also asks to land somewhere asks only on a plain click: a click that opens a new tab or window leaves
// this page where it is.
export function plainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

export type Landing = "landed" | "busy" | "missing" | "hidden";

// Lands on a place: brings it into view and focuses it; an item's row is marked for an instant. When the person acted
// after asking and is now typing in a field or using an open layer, the landing does not take their focus or their
// view. It says when the place is not on the page, or is there and could not take the focus.
export function land(target: FocusTarget, { acted = false }: { acted?: boolean } = {}): Landing {
  const active = document.activeElement as HTMLElement | null;
  const inUse =
    active !== null &&
    active !== document.body &&
    (active.matches("input, textarea, [contenteditable='true'], [role='combobox'], [role='option']") || active.closest("dialog[open], [role='listbox']") !== null);
  if (acted && inUse) return "busy";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let element: HTMLElement | null = null;
  if (target.kind === "node") element = document.querySelector<HTMLElement>("[data-node-title]");
  if (target.kind === "quick-add") element = document.querySelector<HTMLElement>(`[data-quick-add="${target.type}"] input`);
  if (target.kind === "item") element = document.querySelector<HTMLElement>(`[data-item="${target.itemId}"] [data-item-title]`);
  if (!element) return "missing";
  element.focus({ preventScroll: true });
  if (document.activeElement !== element) return "hidden";
  element.scrollIntoView({ block: target.kind === "node" ? "start" : "center", behavior: reduced ? "instant" : "smooth" });
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
