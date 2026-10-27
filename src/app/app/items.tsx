"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { Select, type SelectOption } from "@/components/ui/select";
import { post, tool, type Item } from "./client-api";
import { requestFocus } from "./focus-request";
import { useWorkspace } from "./workspace";

// The priorities' names, from one source: the rows, the quick add, and the palette read them here.
export const PRIORITIES: SelectOption[] = [
  { value: "1", label: "Urgent", tone: "alert" },
  { value: "2", label: "High", tone: "warn" },
  { value: "3", label: "Normal", tone: "neutral" },
  { value: "4", label: "Low", tone: "muted" },
];

export const TYPE_NAMES: Record<Item["type"], string> = { task: "Task", decision: "Decision", link: "Link", review: "To review" };

// Who wrote it, in words: what the chat or an agent did reads apart from what the person typed.
export function Origin({ item }: { item: Item }) {
  if (item.source === "manual") return null;
  return (
    <span className="pill" data-tone={item.source === "chat" ? "accent" : "info"} data-origin={item.source}>
      {item.source === "chat" ? "By the chat" : `By agent ${item.agentLabel}`}
    </span>
  );
}

// A redrawn list travels: what moved goes from its old place to the new one, and what arrives enters; nothing jumps.
export function ItemList({ items, children }: { items: Item[]; children: (item: Item) => ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = el.getBoundingClientRect().top;
    const next = new Map<string, number>();
    const first = last.current.size === 0;
    el.querySelectorAll<HTMLElement>(":scope > [data-key]").forEach((node) => {
      const key = node.dataset.key!;
      const top = node.getBoundingClientRect().top - origin;
      next.set(key, top);
      if (reduced || first) return;
      const before = last.current.get(key);
      if (before === undefined) {
        node.animate([{ opacity: 0.001, translate: "0 0.4rem" }, { opacity: 1, translate: "0 0" }], { duration: 280, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" });
      } else if (Math.abs(before - top) > 1) {
        node.animate([{ translate: `0 ${before - top}px` }, { translate: "0 0" }], { duration: 300, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
      }
    });
    last.current = next;
  });
  return (
    <ul className="rows" ref={list}>
      {items.map((item) => (
        <li key={item.id} data-key={item.id} className="row-fold">
          {children(item)}
        </li>
      ))}
    </ul>
  );
}

// One row: title, priority, due date, and status change in place; Enter confirms, Esc cancels; delete folds the row
// away and offers undo.
export function ItemRow({ item, showPath = false }: { item: Item; showPath?: boolean }) {
  const { saving, notify, touch } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [leaving, setLeaving] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const previous = useRef(item);

  // What changed with the row in view is marked for an instant, whoever changed it.
  useEffect(() => {
    const before = previous.current;
    previous.current = item;
    if (before === item) return;
    const changed = before.title !== item.title || before.status !== item.status || before.priority !== item.priority || before.dueOn !== item.dueOn;
    if (!changed || !row.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    row.current.removeAttribute("data-changed");
    void row.current.offsetWidth;
    row.current.setAttribute("data-changed", "");
    setTitle(item.title);
  }, [item]);

  // The fold lives on the list item around the row, which travels with the list.
  useEffect(() => {
    row.current?.parentElement?.toggleAttribute("data-leaving", leaving);
  }, [leaving]);

  const update = (change: Record<string, unknown>) => saving(tool("update_item", { id: item.id, ...change }));

  async function remove() {
    setLeaving(true);
    // The row folds away first; then it is deleted, and the notice offers to bring it back.
    await new Promise((resolve) => setTimeout(resolve, 220));
    const answer = await tool("delete_item", { id: item.id });
    if (!answer.ok) {
      setLeaving(false);
      return notify({ text: answer.message, tone: "error" });
    }
    touch();
    notify({
      text: `Deleted “${item.title}”`,
      tone: "status",
      undo: () => void saving(post(`/api/items/${item.id}/restore`, {})),
    });
  }

  // Enter commits and the field's blur on unmounting would commit again: the first one wins.
  const committing = useRef(false);

  async function commitTitle() {
    if (committing.current) return;
    committing.current = true;
    setEditing(false);
    requestAnimationFrame(() => titleButton.current?.focus({ preventScroll: true }));
    try {
      if (title.trim() && title !== item.title) {
        if (!(await update({ title }))) setTitle(item.title);
      } else setTitle(item.title);
    } finally {
      committing.current = false;
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void commitTitle();
    if (event.key === "Escape") {
      // Escape cancels; the blur that follows must not save what was discarded.
      committing.current = true;
      setTitle(item.title);
      setEditing(false);
      requestAnimationFrame(() => titleButton.current?.focus({ preventScroll: true }));
      setTimeout(() => (committing.current = false), 0);
    }
  }

  const done = item.status === "done";
  const checkable = item.type === "task" || item.type === "review";
  return (
    <div
      ref={row}
      className="row"
      data-item={item.id}
      data-type={item.type}
      data-done={done}
      inert={leaving}
    >
      {checkable && (
        <span className="row-check">
          <Checkbox
            checked={done}
            aria-label={done ? `Mark “${item.title}” open` : `Mark “${item.title}” done`}
            onCheckedChange={() => void update({ status: done ? "open" : "done" })}
          />
        </span>
      )}
      <div className="row-main">
        {editing ? (
          <Field
            autoFocus
            aria-label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={onKey}
            onBlur={() => void commitTitle()}
          />
        ) : (
          <button
            ref={titleButton}
            type="button"
            className="row-title t-value"
            data-item-title
            onClick={() => setEditing(true)}
            aria-label={`Edit “${item.title}”`}
          >
            {item.title}
          </button>
        )}
        {item.body && <p className="row-body t-help">{item.body}</p>}
        <RowMeta item={item} showPath={showPath} />
      </div>
      {item.type === "task" && (
        <div className="row-chips">
          <div className="row-prio">
            <Select
              look="chip"
              label={`Priority of “${item.title}”`}
              value={String(item.priority ?? 4)}
              options={PRIORITIES}
              onChange={(value) => void update({ priority: Number(value) })}
            />
          </div>
          <div className="row-due">
            <DatePicker look="chip" label={`Due date of “${item.title}”`} value={item.dueOn} onChange={(dueOn) => void update({ dueOn })} />
          </div>
        </div>
      )}
      <div className="row-act">
        {item.url && (item.type === "link" || item.type === "review") && (
          <a className="btn btn-quiet btn-sm" href={item.url} target="_blank" rel="noopener noreferrer">
            <span className="btn-label">Open link</span>
          </a>
        )}
        <Button variant="quiet" size="sm" onClick={() => void remove()} aria-label={`Delete “${item.title}”`}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function RowMeta({ item, showPath }: { item: Item; showPath: boolean }) {
  const origin = item.source !== "manual";
  if (!origin && !showPath && !(item.type === "link" && item.url)) return null;
  return (
    <div className="row-meta">
      {showPath && (
        <Link
          className="link link-meta"
          href={`/app/node/${item.nodeId}`}
          data-path
          onClick={() => requestFocus({ kind: "item", nodeId: item.nodeId, itemId: item.id })}
        >
          {item.nodePath}
        </Link>
      )}
      {item.type === "link" && item.url && <span className="t-meta nowrap-ellipsis">{hostOf(item.url)}</span>}
      <Origin item={item} />
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Quick add on one line: a task takes priority and due date right there; Enter adds and keeps the line ready.
export function QuickAdd({ nodeId, type }: { nodeId: string; type: Item["type"] }) {
  const { saving } = useWorkspace();
  const [title, setTitle] = useState("");
  const [extra, setExtra] = useState("");
  const [priority, setPriority] = useState("4");
  const [dueOn, setDueOn] = useState<string | null>(null);
  // While a send travels a second press does nothing: one intent makes one item.
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (sending.current) return;
    if (type === "link" ? !extra.trim() : !title.trim()) return;
    sending.current = true;
    setBusy(true);
    try {
      await send();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function send() {
    const request =
      type === "task"
        ? tool("create_task", { node: nodeId, title, priority: Number(priority), ...(dueOn ? { dueOn } : {}) })
        : type === "decision"
          ? tool("add_decision", { node: nodeId, decision: title, ...(extra.trim() ? { rationale: extra } : {}) })
          : type === "link"
            ? tool("add_link", { node: nodeId, url: extra, ...(title.trim() ? { title } : {}) })
            : tool("add_review", { node: nodeId, title, ...(extra.trim() ? { url: extra } : {}) });
    if (await saving(request)) {
      setTitle("");
      setExtra("");
      setDueOn(null);
    }
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void add();
  };
  const label = { task: "New task", decision: "New decision", link: "Link title (optional)", review: "Something to review" }[type];
  const extraLabel = { task: "", decision: "Why (optional)", link: "Address (https://…)", review: "Link (optional)" }[type];

  return (
    <div className="quick-add" data-quick-add={type}>
      {type === "link" && (
        <Field aria-label={extraLabel} placeholder={extraLabel} className="grow" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={onKey} />
      )}
      <Field aria-label={label} placeholder={label} className={type === "link" ? "second" : "grow"} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onKey} />
      {type === "task" && (
        <>
          <Select label="Priority of the new task" value={priority} options={PRIORITIES} onChange={setPriority} />
          <DatePicker label="Due date of the new task" value={dueOn} onChange={setDueOn} />
        </>
      )}
      {(type === "decision" || type === "review") && (
        <Field aria-label={extraLabel} placeholder={extraLabel} className="second" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={onKey} />
      )}
      <Button variant="primary" onClick={() => void add()} aria-busy={busy} disabled={busy}>
        {busy ? "Adding…" : "Add"}
      </Button>
    </div>
  );
}
