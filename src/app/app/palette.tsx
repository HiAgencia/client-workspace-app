"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { rank } from "@/lib/fuzzy";
import { currentTheme, setTheme } from "@/lib/theme";
import { tool, type Item, type TreeNode } from "./client-api";
import { land, requestFocus, type FocusTarget } from "./focus-request";
import { TYPE_NAMES } from "./items";
import { useWorkspace } from "./workspace";

type Entry =
  | { kind: "node"; id: string; node: TreeNode }
  | { kind: "item"; id: string; item: Item }
  | { kind: "action"; id: string; label: string; run: () => void };

const KIND_NAMES: Record<TreeNode["kind"], string> = { client: "Client", project: "Project", subproject: "Subproject" };
const LIMIT = { node: 6, item: 8 };

// The command palette (Ctrl/Cmd+K): finds projects, items, and actions though the words carry typos, moves with the
// arrows, and Enter lands on the exact place with the focus set. A native modal dialog: the page behind is inert, Tab
// stays inside, and Escape closes it.
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="dialog palette"
      aria-label="Search projects, tasks, and actions"
      onClose={onClose}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        // A click on the backdrop closes it only when the whole gesture happened outside the panel.
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) onClose();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      {open && <PaletteBody onClose={onClose} />}
    </dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const { tree } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const currentNode = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/)?.[1] ?? null;
  const here = tree?.find((node) => node.id === currentNode);

  // Every item of every project, read when the palette opens: the roots with everything below them.
  useEffect(() => {
    const roots = (tree ?? []).filter((node) => node.parentId === null);
    void Promise.all(roots.map((root) => tool<{ items: Item[] }>("list_items", { node: root.id, status: "all", includeSubprojects: true }))).then(
      (answers) => {
        if (answers.some((answer) => !answer.ok)) setItemsFailed(true);
        setItems(answers.flatMap((answer) => (answer.ok ? answer.items : [])));
      },
    );
  }, [tree]);

  const actions = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      { kind: "action", id: "go-today", label: "Go to Today", run: () => router.push("/app") },
      { kind: "action", id: "go-accounts", label: "Go to Accounts", run: () => router.push("/app/accounts") },
    ];
    if (here) {
      list.push({ kind: "action", id: "new-task", label: `New task in ${here.name}`, run: () => go({ kind: "quick-add", nodeId: here.id, type: "task" }) });
      list.push({ kind: "action", id: "new-decision", label: `Record a decision in ${here.name}`, run: () => go({ kind: "quick-add", nodeId: here.id, type: "decision" }) });
      list.push({ kind: "action", id: "agent", label: `Connect your agent to ${here.name}`, run: () => router.push(`/app/node/${here.id}/agent`) });
    }
    const dark = currentTheme() === "dark";
    list.push({ kind: "action", id: "theme", label: dark ? "Switch to the light theme" : "Switch to the dark theme", run: () => setTheme(dark ? "light" : "dark") });
    return list;
    // `go` reads the router and the path; they are stable for one open palette.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, router]);

  function go(target: FocusTarget) {
    if (pathname === `/app/node/${target.nodeId}`) {
      // Already there: land once the dialog has closed and given the focus back.
      requestAnimationFrame(() => requestAnimationFrame(() => land(target)));
      return;
    }
    requestFocus(target);
    router.push(`/app/node/${target.nodeId}`);
  }

  const groups = useMemo(() => {
    const q = query.trim();
    const nodes = tree ?? [];
    const nodeHits = q
      ? rank(q, nodes, (node) => `${node.name} ${node.path}`).slice(0, LIMIT.node).map((hit) => hit.entry)
      : nodes.slice(0, LIMIT.node);
    const itemHits = q && items ? rank(q, items, (item) => `${item.title} ${item.body ?? ""}`).slice(0, LIMIT.item).map((hit) => hit.entry) : [];
    const actionHits = q ? rank(q, actions, (action) => (action.kind === "action" ? action.label : "")).map((hit) => hit.entry) : actions;
    return [
      { name: "Projects", entries: nodeHits.map((node): Entry => ({ kind: "node", id: `node-${node.id}`, node })) },
      { name: "Tasks and notes", entries: itemHits.map((item): Entry => ({ kind: "item", id: `item-${item.id}`, item })) },
      { name: "Actions", entries: actionHits },
    ].filter((group) => group.entries.length > 0);
  }, [query, tree, items, actions]);

  const flat = groups.flatMap((group) => group.entries);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => {
    if (!current) return;
    list.current?.querySelector(`#palette-${CSS.escape(current.id)}`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function open(entry: Entry) {
    onClose();
    if (entry.kind === "node") go({ kind: "node", nodeId: entry.node.id });
    else if (entry.kind === "item") go({ kind: "item", nodeId: entry.item.nodeId, itemId: entry.item.id });
    else entry.run();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (Math.min(index, flat.length - 1) + delta + flat.length) % flat.length);
    }
    if (event.key === "Enter" && current) {
      event.preventDefault();
      open(current);
    }
  }

  const searching = query.trim().length > 0;
  return (
    <div className="palette-inner">
      <div className="palette-search">
        <input
          autoFocus
          className="field"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={current ? `palette-${current.id}` : undefined}
          aria-label="Search projects, tasks, and actions"
          placeholder="Search projects, tasks, and actions"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
      </div>
      <div className="palette-list" id="palette-list" role="listbox" aria-label="Results" ref={list}>
        {groups.map((group) => (
          <div key={group.name} role="group" aria-labelledby={`palette-group-${group.name}`}>
            <div id={`palette-group-${group.name}`} role="presentation" className="palette-group-label t-label">
              {group.name}
            </div>
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                id={`palette-${entry.id}`}
                role="option"
                aria-selected={entry === current}
                data-highlighted={entry === current ? "" : undefined}
                className="option palette-option"
                onPointerMove={() => setActive(flat.indexOf(entry))}
                onClick={() => open(entry)}
              >
                <EntryView entry={entry} />
              </div>
            ))}
          </div>
        ))}
        {searching && items === null && (
          <p className="palette-group-label t-help" role="status">
            Reading tasks and notes…
          </p>
        )}
        {itemsFailed && (
          <p className="palette-group-label t-help" role="status">
            Some tasks and notes could not be read; projects and actions still work.
          </p>
        )}
        {flat.length === 0 && (
          <p className="palette-group-label t-help" role="status">
            Nothing matches “{query.trim()}”. Try fewer letters or another word.
          </p>
        )}
      </div>
      <p className="palette-foot t-meta">Arrows move, Enter opens, Escape closes.</p>
    </div>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === "node") {
    return (
      <>
        <span className="pill">{KIND_NAMES[entry.node.kind]}</span>
        <span className="stack palette-text">
          <span className="t-name">{entry.node.name}</span>
          {entry.node.path !== entry.node.name && <span className="t-meta">{entry.node.path}</span>}
        </span>
      </>
    );
  }
  if (entry.kind === "item") {
    const { item } = entry;
    return (
      <>
        <span className="pill" data-tone={item.status === "done" ? undefined : "accent"}>
          {item.status === "done" ? "Done" : TYPE_NAMES[item.type]}
        </span>
        <span className="stack palette-text">
          <span className="t-value">{item.title}</span>
          <span className="t-meta">{item.nodePath}</span>
        </span>
      </>
    );
  }
  return (
    <>
      <span className="pill" data-tone="info">
        Action
      </span>
      <span className="t-value">{entry.label}</span>
    </>
  );
}
