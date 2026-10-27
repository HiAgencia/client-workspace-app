"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { dueLabel } from "@/lib/dates";
import { tool, type Item } from "./client-api";
import { Origin, PRIORITIES, TYPE_NAMES } from "./item-parts";

type Saving = (promise: Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
type Status = "" | "saving" | "saved" | "failed";

const SAY: Record<Exclude<Status, "">, string> = { saving: "Saving…", saved: "Saved", failed: "Not saved" };

// The item's secondary detail in a side panel, not another page. Its body saves when typing stops and on leaving; Escape
// closes it once nothing is pending, and the shell gives the focus back to the row it came from. The native dialog brings
// the trapped focus, Escape and the inert page.
export function ItemPanel({ item, saving, onClose }: { item: Item | null; saving: Saving; onClose: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [shown, setShown] = useState<Item | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("");
  const titleId = useId();
  const notesId = useId();

  // What the panel draws while the dialog leaves, so its content stays whole through the exit.
  const current = item ?? shown;
  const id = useRef<string | null>(null);
  const latest = useRef("");
  const confirmed = useRef("");
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (item && !el.open) {
      id.current = item.id;
      latest.current = item.body ?? "";
      confirmed.current = item.body ?? "";
      pending.current = null;
      setShown(item);
      setNotes(item.body ?? "");
      setStatus("");
      el.showModal();
      // The body is the panel's field: it takes the focus when the panel opens.
      requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    } else if (!item && el.open) {
      el.close();
    }
  }, [item]);

  function edit(value: string) {
    setNotes(value);
    latest.current = value;
    setStatus("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }

  // One save at a time, in order: what the person typed after a save traveled is written by the next one, never before it.
  function flush(): Promise<unknown> {
    clearTimeout(timer.current);
    const value = latest.current.trim();
    const itemId = id.current;
    if (!itemId || value === confirmed.current) return queue.current;
    if (value === pending.current) return queue.current;
    pending.current = value;
    setStatus("saving");
    queue.current = queue.current.then(async () => {
      const ok = await saving(tool("update_item", { id: itemId, notes: value || null }));
      if (pending.current === value) pending.current = null;
      if (id.current !== itemId) return;
      if (!ok) return setStatus("failed");
      confirmed.current = value;
      setStatus(latest.current.trim() === value ? "saved" : "saving");
    });
    return queue.current;
  }

  // Escape and the close button wait for what is pending; a failure keeps the panel open with the text in its field.
  function close() {
    if (latest.current.trim() === confirmed.current) return void dialog.current?.close();
    void flush().then(() => {
      if (latest.current.trim() === confirmed.current) dialog.current?.close();
    });
  }

  const task = current && current.type === "task" ? current : null;
  const priority = task ? PRIORITIES.find((option) => option.value === String(task.priority ?? 4))?.label : null;

  return (
    <dialog
      ref={dialog}
      className="dialog panel"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // The save of what is pending decides when it closes, not the key.
        event.preventDefault();
        close();
      }}
      onClose={() => {
        void flush();
        if (id.current) onClose(id.current);
      }}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) close();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      {current && (
        <div className="panel-in">
          <header className="panel-head">
            <div className="panel-title">
              <p className="t-label">{TYPE_NAMES[current.type]}</p>
              <h2 id={titleId} className="t-title">
                {current.title}
              </h2>
            </div>
            <Button size="sm" onClick={close}>
              Close
            </Button>
          </header>
          <p className="t-meta panel-path">{current.nodePath}</p>
          <div className="panel-meta">
            {current.type === "task" && <span className="pill">{priority}</span>}
            {current.type === "task" && current.dueOn && <span className="pill">{dueLabel(current.dueOn)}</span>}
            <Origin item={current} />
          </div>
          {current.url && (current.type === "link" || current.type === "review") && (
            <a className="link" href={current.url} target="_blank" rel="noopener noreferrer">
              Open link
            </a>
          )}
          <div className="panel-field">
            <label className="t-label" htmlFor={notesId}>
              Notes
            </label>
            <p className="t-help">Saves when you stop typing.</p>
            <TextArea
              ref={field}
              id={notesId}
              value={notes}
              rows={5}
              placeholder="What matters about this item…"
              onChange={(event) => edit(event.target.value)}
              onBlur={() => void flush()}
            />
            <p className="t-meta panel-status" role="status" data-panel-status={status || undefined}>
              {status ? SAY[status] : ""}
            </p>
          </div>
        </div>
      )}
    </dialog>
  );
}
