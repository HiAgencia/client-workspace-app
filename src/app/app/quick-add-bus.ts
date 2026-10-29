// Opening quick add from anywhere —the sidebar's «Add task», the «Q» key, the phone's fixed button, a group's foot—
// without each caller knowing the dialog: a caller asks with what the new task starts with, and the dialog listens.
// A place left out starts the task where the dialog decides (General); `null` asks for General on purpose.

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
