"use client";



export type FocusTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "item"; nodeId: string; itemId: string }
  | { kind: "quick-add"; nodeId: string; type: "task" | "decision" | "link" | "review" };

const EVENT = "client-workspace:focus";
let pending: FocusTarget | null = null;

export function requestFocus(target: FocusTarget): void {
  pending = target;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function takeFocusRequest(nodeId: string): FocusTarget | null {
  if (!pending || pending.nodeId !== nodeId) return null;
  const target = pending;
  pending = null;
  return target;
}

export function onFocusRequest(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}




export function land(target: FocusTarget, root: ParentNode = document): boolean {
  const active = document.activeElement as HTMLElement | null;
  const busy =
    active !== null &&
    active !== document.body &&
    (active.matches("input, textarea, [contenteditable='true'], [role='combobox'], [role='option']") || active.closest("dialog[open], [role='listbox']") !== null);
  if (busy) return false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let element: HTMLElement | null = null;
  if (target.kind === "node") element = root.querySelector<HTMLElement>("[data-node-title]");
  if (target.kind === "quick-add") element = root.querySelector<HTMLElement>(`[data-quick-add="${target.type}"] input`);
  if (target.kind === "item") element = root.querySelector<HTMLElement>(`[data-item="${target.itemId}"] [data-item-title]`);
  if (!element) return false;
  element.scrollIntoView({ block: target.kind === "node" ? "start" : "center", behavior: reduced ? "instant" : "smooth" });
  element.focus({ preventScroll: true });
  if (target.kind === "item") {
    const row = element.closest<HTMLElement>("[data-item]");
    if (row && !reduced) {
      row.removeAttribute("data-changed");
      void row.offsetWidth;
      row.setAttribute("data-changed", "");
    }
  }
  return true;
}
