"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RichEditor } from "@/components/ui/rich-editor";
import { LOCALE } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { get, post, tool, type Item } from "./client-api";
import { Origin, TYPE_NAMES } from "./item-parts";

type Saving = (promise: Promise<{ ok: boolean; message?: string }>) => Promise<boolean>;
type Status = "" | "saving" | "saved" | "failed";
type Revision = {
  id: string;
  createdAt: string;
  source: "manual" | "chat" | "agent";
  agentLabel: string | null;
  snapshot: { title: string; status: string; deleted_at: string | null };
};

const SAY: Record<Exclude<Status, "">, string> = { saving: "Saving…", saved: "Saved", failed: "Not saved" };

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const by = (source: Revision["source"], label: string | null) => (source === "chat" ? "the chat" : source === "agent" ? `agent ${label}` : "you");

// A note's or a decision's record in a side panel, not another page: its text (rich, saved when typing stops and on
// leaving) and the versions it left, each restorable. A task opens in its own detail (`task-detail.tsx`). Escape closes
// it once nothing is pending, and the shell gives the focus back to the row it came from. The native dialog brings the
// trapped focus, Escape and the inert page.
export function ItemPanel({
  item,
  saving,
  version,
  onClose,
  onDelete,
}: {
  item: Item | null;
  saving: Saving;
  version: number;
  onClose: (id: string) => void;
  // Deleting closes the panel first: the row it came from folds away, and the notice offers to bring it back.
  onDelete: (item: Item) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<Item | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const titleId = useId();
  const notesId = useId();

  // What the panel draws while the dialog leaves, so its content stays whole through the exit.
  // Once open, the panel shows the item as the server last answered it (a restored version, a changed field).
  const current = item && shown && shown.id === item.id ? shown : (item ?? shown);
  const id = useRef<string | null>(null);
  const latest = useRef("");
  const confirmed = useRef("");
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (item && (!el.open || id.current !== item.id)) {
      id.current = item.id;
      latest.current = item.body ?? "";
      confirmed.current = item.body ?? "";
      pending.current = null;
      setShown(item);
      setNotes(item.body ?? "");
      setStatus("");
      setRevisions(null);
      if (!el.open) el.showModal();
      // The text is the panel's field: it takes the focus when the panel opens.
      requestAnimationFrame(() => el.querySelector<HTMLElement>(".rich-field")?.focus({ preventScroll: true }));
    } else if (!item && el.open) {
      el.close();
    }
  }, [item]);

  // The versions are read when the panel opens, and again when something changed.
  const openId = item?.id ?? null;
  useEffect(() => {
    if (!openId) return;
    let live = true;
    void get<{ revisions: Revision[] }>(`/api/items/${openId}/revisions`).then((versions) => {
      if (live && versions.ok) setRevisions(versions.revisions);
    });
    return () => {
      live = false;
    };
  }, [openId, version]);

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

  // A restored version comes back into the panel as the item's text now is.
  async function restore(revisionId: string) {
    const answer = await post<{ item: Item }>(`/api/revisions/${revisionId}/restore`, {});
    if (!(await saving(Promise.resolve(answer))) || !answer.ok || answer.item.id !== id.current) return;
    latest.current = answer.item.body ?? "";
    confirmed.current = answer.item.body ?? "";
    setShown(answer.item);
    setNotes(answer.item.body ?? "");
  }

  const fieldName = current?.type === "note" ? "Note" : current?.type === "decision" ? "Why" : "Notes";

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
                {inlinePlain(current.title)}
              </h2>
            </div>
            <Button size="sm" onClick={close}>
              Close
            </Button>
          </header>
          {current.nodeId ? (
            <Link className="link t-meta panel-path" href={`/app/node/${current.nodeId}`} data-panel-path>
              {current.nodePath}
            </Link>
          ) : (
            <span className="t-meta panel-path" data-panel-path>
              General
            </span>
          )}
          <div className="panel-record" data-panel-record>
            <Origin item={current} />
          </div>
          <div className="panel-field">
            <label className="t-label" htmlFor={notesId}>
              {fieldName}
            </label>
            <p className="t-help">Saves when you stop typing. Select words to make them bold, colored, or a link.</p>
            <RichEditor key={current.id} id={notesId} label={fieldName} value={notes} placeholder="What matters about this item…" onChange={edit} onBlur={() => void flush()} onEscape={close} />
            <p className="t-meta panel-status" role="status" data-panel-status={status || undefined}>
              {status ? SAY[status] : ""}
            </p>
          </div>
          <Versions revisions={revisions} onRestore={restore} />
          <div className="panel-foot">
            <Button
              variant="quiet"
              size="sm"
              data-panel-delete
              onClick={() => {
                const doomed = current;
                void flush().then(() => {
                  dialog.current?.close();
                  onDelete(doomed);
                });
              }}
            >
              {`Delete this ${TYPE_NAMES[current.type].toLowerCase()}`}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// The versions an item left, newest first: each is the item before a change, with who changed it and when.
function Versions({ revisions, onRestore }: { revisions: Revision[] | null; onRestore: (id: string) => Promise<void> }) {
  if (revisions === null || revisions.length === 0) {
    return (
      <section className="panel-section stack" aria-labelledby="panel-versions" data-panel-versions>
        <h3 id="panel-versions" className="t-label">
          Versions
        </h3>
        <p className="t-help">{revisions === null ? "Reading the versions…" : "No earlier versions: every change from now on leaves one here."}</p>
      </section>
    );
  }
  return (
    <section className="panel-section stack" aria-labelledby="panel-versions" data-panel-versions>
      <h3 id="panel-versions" className="t-label">
        Versions <span className="t-meta">{revisions.length}</span>
      </h3>
      <ul className="plain-list stack">
        {revisions.slice(0, 12).map((revision) => (
          <li key={revision.id} className="account-line" data-revision={revision.id}>
            <span className="stack" style={{ gap: "0.1rem" }}>
              <span className="t-value">{revision.snapshot.deleted_at ? `Deleted: ${revision.snapshot.title}` : revision.snapshot.title}</span>
              <span className="t-meta">
                Before a change by {by(revision.source, revision.agentLabel)}, {stamp(revision.createdAt)}
              </span>
            </span>
            <Button size="sm" variant="quiet" onClick={() => void onRestore(revision.id)} aria-label={`Restore the version of ${stamp(revision.createdAt)}`}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
