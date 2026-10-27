"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { post, tool, type Item } from "./client-api";
import { useWorkspace } from "./workspace";

const PRIORITIES = [
  { value: 1, label: "P1 urgent" },
  { value: 2, label: "P2 high" },
  { value: 3, label: "P3 normal" },
  { value: 4, label: "P4 low" },
];

// Who wrote it, in words: what the chat or an agent did reads apart from what the person typed.
export function Origin({ item }: { item: Item }) {
  if (item.source === "manual") return null;
  return <span data-origin={item.source}>{item.source === "chat" ? "by the chat" : `by agent ${item.agentLabel}`}</span>;
}

// One row: title, priority, due date, and status change in place; Enter confirms, Esc cancels; delete offers undo.
export function ItemRow({ item, showPath = false }: { item: Item; showPath?: boolean }) {
  const { saving, notify, touch } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);

  const update = (change: Record<string, unknown>) => saving(tool("update_item", { id: item.id, ...change }));

  async function remove() {
    const answer = await tool("delete_item", { id: item.id });
    if (!answer.ok) return notify({ text: answer.message, tone: "error" });
    touch();
    notify({
      text: `Deleted "${item.title}"`,
      tone: "status",
      undo: () => void saving(post(`/api/items/${item.id}/restore`, {})),
    });
  }

  async function commitTitle() {
    setEditing(false);
    if (title.trim() && title !== item.title) {
      if (!(await update({ title }))) setTitle(item.title);
    } else setTitle(item.title);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void commitTitle();
    if (event.key === "Escape") {
      setTitle(item.title);
      setEditing(false);
    }
  }

  const done = item.status === "done";
  return (
    <li className="flex flex-wrap items-center gap-3" data-item={item.id} data-type={item.type}>
      {(item.type === "task" || item.type === "review") && (
        <input
          type="checkbox"
          aria-label={done ? `Mark "${item.title}" open` : `Mark "${item.title}" done`}
          checked={done}
          onChange={() => void update({ status: done ? "open" : "done" })}
        />
      )}
      {editing ? (
        <Input
          autoFocus
          aria-label="Title"
          className="max-w-md"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onKey}
          onBlur={() => void commitTitle()}
        />
      ) : (
        <button type="button" className={done ? "line-through" : undefined} onClick={() => setEditing(true)} aria-label={`Edit "${item.title}"`}>
          {item.title}
        </button>
      )}
      {item.type === "link" && item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          Open link
        </a>
      )}
      {item.type === "review" && item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          Open
        </a>
      )}
      {item.type === "task" && (
        <>
          <select
            aria-label="Priority"
            value={item.priority ?? 4}
            onChange={(event) => void update({ priority: Number(event.target.value) })}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Due date"
            value={item.dueOn ?? ""}
            onChange={(event) => void update({ dueOn: event.target.value || null })}
          />
        </>
      )}
      {item.body && <span>{item.body}</span>}
      {showPath && <span data-path>{item.nodePath}</span>}
      <Origin item={item} />
      <Button variant="ghost" size="sm" onClick={() => void remove()}>
        Delete
      </Button>
    </li>
  );
}

// Quick add on one line: a task takes priority and due date right there; Enter adds and keeps the line ready.
export function QuickAdd({ nodeId, type }: { nodeId: string; type: Item["type"] }) {
  const { saving } = useWorkspace();
  const [title, setTitle] = useState("");
  const [extra, setExtra] = useState("");
  const [priority, setPriority] = useState(4);
  const [dueOn, setDueOn] = useState("");

  async function add() {
    if (type === "link" ? !extra.trim() : !title.trim()) return;
    const request =
      type === "task"
        ? tool("create_task", { node: nodeId, title, priority, ...(dueOn ? { dueOn } : {}) })
        : type === "decision"
          ? tool("add_decision", { node: nodeId, decision: title, ...(extra.trim() ? { rationale: extra } : {}) })
          : type === "link"
            ? tool("add_link", { node: nodeId, url: extra, ...(title.trim() ? { title } : {}) })
            : tool("add_review", { node: nodeId, title, ...(extra.trim() ? { url: extra } : {}) });
    if (await saving(request)) {
      setTitle("");
      setExtra("");
      setDueOn("");
    }
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void add();
  };
  const label = { task: "New task", decision: "New decision", link: "Link title (optional)", review: "Something to review" }[type];
  const extraLabel = { task: "", decision: "Why (optional)", link: "Address (https://…)", review: "Link (optional)" }[type];

  return (
    <div className="flex flex-wrap items-center gap-2" data-quick-add={type}>
      {type === "link" && (
        <Input aria-label={extraLabel} placeholder={extraLabel} className="max-w-xs" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={onKey} />
      )}
      <Input aria-label={label} placeholder={label} className="max-w-sm" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onKey} />
      {type === "task" && (
        <>
          <select aria-label="Priority of the new task" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input type="date" aria-label="Due date of the new task" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </>
      )}
      {(type === "decision" || type === "review") && (
        <Input aria-label={extraLabel} placeholder={extraLabel} className="max-w-xs" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={onKey} />
      )}
      <Button size="sm" onClick={() => void add()}>
        Add
      </Button>
    </div>
  );
}
