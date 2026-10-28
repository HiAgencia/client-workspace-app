"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { RichEditor, RichText } from "@/components/ui/rich-editor";
import { LOCALE } from "@/lib/dates";
import { get, post, tool, type Item } from "./client-api";
import { Origin, PRIORITIES, TYPE_NAMES } from "./item-parts";

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

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const by = (source: Revision["source"], label: string | null) => (source === "chat" ? "the chat" : source === "agent" ? `agent ${label}` : "you");

// The item's record in a side panel, not another page: its text (rich, saved when typing stops and on leaving), what
// hangs from a task —subtasks, notes, links—, and the versions it left, each restorable. Escape closes it once nothing
// is pending, and the shell gives the focus back to the row it came from. The native dialog brings the trapped focus,
// Escape and the inert page.
export function ItemPanel({
  item,
  saving,
  version,
  onClose,
  onOpenItem,
}: {
  item: Item | null;
  saving: Saving;
  version: number;
  onClose: (id: string) => void;
  onOpenItem: (item: Item) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<Item | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [children, setChildren] = useState<Item[] | null>(null);
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
      setChildren(null);
      setRevisions(null);
      if (!el.open) el.showModal();
      // The text is the panel's field: it takes the focus when the panel opens.
      requestAnimationFrame(() => el.querySelector<HTMLElement>(".rich-field")?.focus({ preventScroll: true }));
    } else if (!item && el.open) {
      el.close();
    }
  }, [item]);

  // What hangs from a task and the versions are read when the panel opens, and again when something changed.
  const openId = item?.id ?? null;
  const isTask = item?.type === "task";
  useEffect(() => {
    if (!openId) return;
    let live = true;
    void Promise.all([
      isTask ? tool<{ items: Item[] }>("list_items", { parent: openId, status: "all" }) : Promise.resolve(null),
      get<{ revisions: Revision[] }>(`/api/items/${openId}/revisions`),
    ]).then(([kids, versions]) => {
      if (!live) return;
      if (kids?.ok) setChildren(kids.items);
      if (versions.ok) setRevisions(versions.revisions);
    });
    return () => {
      live = false;
    };
  }, [openId, isTask, version]);

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

  // A field of the record changes in place, and the panel shows the item as the server answered it.
  async function change(patch: Record<string, unknown>) {
    const itemId = id.current;
    if (!itemId) return;
    const answer = await tool<{ item: Item }>("update_item", { id: itemId, ...patch });
    if ((await saving(Promise.resolve(answer))) && answer.ok && id.current === itemId) setShown({ ...answer.item, body: latest.current || null });
  }

  const task = current && current.type === "task" ? current : null;
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
              <p className="t-label">{current.parentId && current.type === "task" ? "Subtask" : TYPE_NAMES[current.type]}</p>
              <h2 id={titleId} className="t-title">
                {current.title}
              </h2>
            </div>
            <Button size="sm" onClick={close}>
              Close
            </Button>
          </header>
          <Link className="link t-meta panel-path" href={`/app/node/${current.nodeId}`} data-panel-path>
            {current.nodePath}
          </Link>
          <div className="panel-record" data-panel-record>
            {(current.type === "task" || current.type === "review") && (
              <span className="check-row">
                <Checkbox
                  checked={current.status === "done"}
                  aria-label={current.status === "done" ? `Mark “${current.title}” open` : `Mark “${current.title}” done`}
                  onCheckedChange={() => void change({ status: current.status === "done" ? "open" : "done" })}
                />
                <span className="t-value">{current.status === "done" ? "Done" : "Open"}</span>
              </span>
            )}
            {current.type === "task" && (
              <>
                <Select look="chip" label={`Priority of “${current.title}”`} value={String(current.priority ?? 4)} options={PRIORITIES} onChange={(value) => void change({ priority: Number(value) })} />
                <DatePicker look="chip" label={`Due date of “${current.title}”`} value={current.dueOn} onChange={(dueOn) => void change({ dueOn })} />
              </>
            )}
            <Origin item={current} />
          </div>
          {(current.type === "link" || current.type === "review") && <LinkField key={current.id} url={current.url} required={current.type === "link"} onSave={(url) => change({ url })} />}
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
          {task && <TaskEvent key={`${task.id}:${version}`} task={task} saving={saving} />}
          {task && (
            <TaskBranch
              task={task}
              items={children}
              saving={saving}
              onOpenItem={onOpenItem}
            />
          )}
          <Versions revisions={revisions} onRestore={restore} />
        </div>
      )}
    </dialog>
  );
}

// The event a task lives in: its title and day, and taking it out. Putting it in one is done from the calendar's day.
function TaskEvent({ task, saving }: { task: Item; saving: Saving }) {
  const [state, setState] = useState<{ link: { googleEventId: string | null } | null; event: { title: string; allDay: boolean; startsOn: string | null; startsAt: string | null } | null } | null>(null);
  useEffect(() => {
    void get<{ link: { googleEventId: string | null } | null; event: { title: string; allDay: boolean; startsOn: string | null; startsAt: string | null } | null }>(`/api/items/${task.id}/event`).then(
      (answer) => answer.ok && setState(answer),
    );
  }, [task.id]);
  if (!state?.link) return null;
  const when = state.event ? (state.event.allDay ? state.event.startsOn : state.event.startsAt && stamp(state.event.startsAt)) : null;
  return (
    <section className="panel-section stack" aria-labelledby="panel-event" data-panel-event>
      <h3 id="panel-event" className="t-label">
        In an event
      </h3>
      <div className="account-line">
        <span className="t-value">{state.event ? `${state.event.title}${when ? ` · ${when}` : ""}` : "A Google event"}</span>
        <Button size="sm" variant="quiet" onClick={() => void saving(tool("unlink_task_event", { task: task.id })).then((ok) => ok && setState({ link: null, event: null }))}>
          Take it out
        </Button>
      </div>
    </section>
  );
}

// The item's address: edited in place, saved on Enter or on leaving the field, opened in a new tab.
function LinkField({ url, required, onSave }: { url: string | null; required: boolean; onSave: (url: string | null) => Promise<void> }) {
  const [value, setValue] = useState(url ?? "");
  const [invalid, setInvalid] = useState(false);
  async function save() {
    const next = value.trim();
    if (next === (url ?? "")) return;
    if (!next && required) return setInvalid(true);
    if (next && !/^https?:\/\//i.test(next)) return setInvalid(true);
    setInvalid(false);
    await onSave(next || null);
  }
  return (
    <div className="panel-field">
      <label className="t-label" htmlFor="panel-link">
        Link
      </label>
      <div className="quick-add">
        <Field
          id="panel-link"
          name="panel-link"
          className="grow"
          value={value}
          placeholder="https://…"
          aria-invalid={invalid || undefined}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => event.key === "Enter" && void save()}
        />
        {url && (
          <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">
            <span className="btn-label">Open link</span>
          </a>
        )}
      </div>
      {invalid && (
        <p className="inline-note" data-tone="alert">
          {required && !value.trim() ? "A link needs its address." : "Write a web address that starts with http:// or https://."}
        </p>
      )}
    </div>
  );
}

// What hangs from a task: its subtasks (completed in place, opened in this same panel), its notes, and its links.
function TaskBranch({ task, items, saving, onOpenItem }: { task: Item; items: Item[] | null; saving: Saving; onOpenItem: (item: Item) => void }) {
  if (items === null) {
    return (
      <div className="stack" role="status" aria-label="Loading what hangs from the task" aria-busy="true">
        <span className="skeleton" style={{ width: "60%" }} />
        <span className="skeleton" style={{ width: "40%" }} />
      </div>
    );
  }
  const subtasks = items.filter((child) => child.type === "task");
  const notes = items.filter((child) => child.type === "note");
  const links = items.filter((child) => child.type === "link");
  return (
    <>
      <section className="panel-section stack" aria-labelledby="panel-subtasks" data-panel-subtasks>
        <h3 id="panel-subtasks" className="t-label">
          Subtasks {subtasks.length > 0 && <span className="t-meta">{subtasks.filter((s) => s.status === "done").length} of {subtasks.length} done</span>}
        </h3>
        {subtasks.length > 0 && (
          <ul className="plain-list stack panel-children">
            {subtasks.map((sub) => (
              <li key={sub.id} className="check-row" data-subtask={sub.id}>
                <Checkbox
                  checked={sub.status === "done"}
                  aria-label={sub.status === "done" ? `Mark “${sub.title}” open` : `Mark “${sub.title}” done`}
                  onCheckedChange={() => void saving(tool("update_item", { id: sub.id, status: sub.status === "done" ? "open" : "done" }))}
                />
                <button type="button" className="link t-value panel-child-title" data-done={sub.status === "done"} onClick={() => onOpenItem(sub)}>
                  {sub.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <OneLineAdd
          label="New subtask"
          onAdd={(title) => saving(tool("create_task", { parent: task.id, title }))}
        />
      </section>
      <section className="panel-section stack" aria-labelledby="panel-notes" data-panel-notes>
        <h3 id="panel-notes" className="t-label">
          Notes {notes.length > 0 && <span className="t-meta">{notes.length}</span>}
        </h3>
        {notes.map((note) => (
          <button key={note.id} type="button" className="panel-note" onClick={() => onOpenItem(note)} aria-label={`Open the note “${note.title}”`}>
            <RichText html={note.body} />
          </button>
        ))}
        <OneLineAdd label="New note on this task" onAdd={(text) => saving(tool("add_note", { parent: task.id, text }))} />
      </section>
      <section className="panel-section stack" aria-labelledby="panel-links" data-panel-links>
        <h3 id="panel-links" className="t-label">
          Links {links.length > 0 && <span className="t-meta">{links.length}</span>}
        </h3>
        {links.length > 0 && (
          <ul className="plain-list stack">
            {links.map((link) => (
              <li key={link.id} className="account-line">
                <a className="link t-value" href={link.url ?? undefined} target="_blank" rel="noopener noreferrer">
                  {link.title}
                </a>
              </li>
            ))}
          </ul>
        )}
        <OneLineAdd label="Link address (https://…)" onAdd={(url) => saving(tool("add_link", { parent: task.id, url }))} />
      </section>
    </>
  );
}

function OneLineAdd({ label, onAdd }: { label: string; onAdd: (value: string) => Promise<boolean> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (busy || !value.trim()) return;
    setBusy(true);
    try {
      if (await onAdd(value.trim())) setValue("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quick-add">
      <Field
        aria-label={label}
        placeholder={label}
        className="grow"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => event.key === "Enter" && void add()}
      />
      <Button size="sm" onClick={() => void add()} aria-busy={busy} disabled={busy}>
        {busy ? "Adding…" : "Add"}
      </Button>
    </div>
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
