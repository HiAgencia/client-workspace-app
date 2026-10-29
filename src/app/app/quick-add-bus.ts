



export type QuickAddStart = {
  placeId?: string | null;
  day?: string | null;
  parentId?: string | null;
};

const EVENT = "quick-add:open";

export function openQuickAdd(start: QuickAddStart = {}): void {
  window.dispatchEvent(new CustomEvent<QuickAddStart>(EVENT, { detail: start }));
}

export function onOpenQuickAdd(handler: (start: QuickAddStart) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<QuickAddStart>).detail ?? {});
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
