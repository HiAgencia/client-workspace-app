"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { prepare, rank } from "@/lib/fuzzy";
import { currentTheme, setTheme } from "@/lib/theme";
import { tool, type Item, type TreeNode } from "./client-api";
import { requestFocus, type FocusTarget } from "./focus-request";
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const currentNode = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/)?.[1] ?? null;
  const here = tree?.find((node) => node.id === currentNode);

  // Every item of every project, read when the palette opens: the roots with everything below them. It reads again only
  // when the roots change, and an answer that arrives after a newer read started does not paint.
  const rootIds = (tree ?? [])
    .filter((node) => node.parentId === null)
    .map((node) => node.id)
    .join(",");
  useEffect(() => {
    let live = true;
    const roots = rootIds ? rootIds.split(",") : [];
    void Promise.all(roots.map((id) => tool<{ items: Item[] }>("list_items", { node: id, status: "all", includeSubprojects: true }))).then((answers) => {
      if (!live) return;
      setItemsFailed(answers.some((answer) => !answer.ok));
      // A review already reviewed has no place on its node's page, so it is not offered: there would be nowhere to land.
      setItems(answers.flatMap((answer) => (answer.ok ? answer.items : [])).filter((item) => !(item.type === "review" && item.status === "done")));
    });
    return () => {
      live = false;
    };
  }, [rootIds]);

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

  // The landing is asked for in every case: on another node it waits for that page, on this one the page takes it once
  // the dialog has closed.
  function go(target: FocusTarget) {
    requestFocus(target);
    if (pathname !== `/app/node/${target.nodeId}`) router.push(`/app/node/${target.nodeId}`);
  }

  // Each text is prepared for the search once, when it arrives, not on every key press.
  const nodeIndex = useMemo(() => (tree ?? []).map((node) => ({ node, prepared: prepare(`${node.name} ${node.path}`) })), [tree]);
  const itemIndex = useMemo(() => (items ?? []).map((item) => ({ item, prepared: prepare(`${item.title} ${item.body ?? ""}`) })), [items]);
  const actionIndex = useMemo(() => actions.map((action) => ({ action, prepared: prepare(action.kind === "action" ? action.label : "") })), [actions]);

  const groups = useMemo(() => {
    const q = query.trim();
    const nodeHits = q ? rank(q, nodeIndex, (hit) => hit.prepared).slice(0, LIMIT.node).map((hit) => hit.entry.node) : (tree ?? []).slice(0, LIMIT.node);
    const itemHits = q ? rank(q, itemIndex, (hit) => hit.prepared).slice(0, LIMIT.item).map((hit) => hit.entry.item) : [];
    const actionHits = q ? rank(q, actionIndex, (hit) => hit.prepared).map((hit) => hit.entry.action) : actions;
    return [
      { key: "projects", name: "Projects", entries: nodeHits.map((node): Entry => ({ kind: "node", id: `node-${node.id}`, node })) },
      { key: "items", name: "Tasks and notes", entries: itemHits.map((item): Entry => ({ kind: "item", id: `item-${item.id}`, item })) },
      { key: "actions", name: "Actions", entries: actionHits },
    ].filter((group) => group.entries.length > 0);
  }, [query, tree, nodeIndex, itemIndex, actionIndex, actions]);

  // The marked entry is kept by its identity, so results that arrive later do not move the mark to another one; once it
  // is gone, nothing is marked instead of opening an entry the person did not choose.
  const flat = groups.flatMap((group) => group.entries);
  const current = activeId === null ? flat[0] : (flat.find((entry) => entry.id === activeId) ?? null);

  useEffect(() => {
    if (!current) return;
    list.current?.querySelector(`#palette-${CSS.escape(current.id)}`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function open(entry: Entry) {
    onClose();
    if (entry.kind === "node") go({ kind: "node", nodeId: entry.node.id });
    else if (entry.kind === "item") go({ kind: "item", nodeId: entry.item.nodeId, itemId: entry.item.id, title: entry.item.title, type: entry.item.type });
    else entry.run();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const desde = current ? flat.indexOf(current) : delta > 0 ? -1 : 0;
      if (flat.length > 0) setActiveId(flat[(desde + delta + flat.length) % flat.length].id);
    }
    if (event.key === "Enter" && current) {
      event.preventDefault();
      open(current);
    }
  }

  const searching = query.trim().length > 0;
  // One sentence, outside the list, for what the list cannot say by itself.
  const note =
    flat.length === 0
      ? `Nothing matches “${query.trim()}”. Try fewer letters or another word.`
      : searching && items === null
        ? "Reading tasks and notes…"
        : itemsFailed
          ? "Some tasks and notes could not be read; projects and actions still work."
          : "";
  return (
    <div className="palette-inner">
      <div className="palette-search">
        <input
          autoFocus
          className="field"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={flat.length > 0 ? "palette-list" : undefined}
          aria-autocomplete="list"
          aria-activedescendant={current ? `palette-${current.id}` : undefined}
          aria-label="Search projects, tasks, and actions"
          placeholder="Search projects, tasks, and actions"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
          onKeyDown={onKey}
        />
      </div>
      {flat.length > 0 && (
        <div className="palette-list" id="palette-list" role="listbox" aria-label="Results" ref={list}>
          {groups.map((group) => (
            <div key={group.key} role="group" aria-labelledby={`palette-group-${group.key}`}>
              <div id={`palette-group-${group.key}`} role="presentation" className="palette-group-label t-label">
                {group.name}
              </div>
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  id={`palette-${entry.id}`}
                  role="option"
                  aria-selected={entry.id === current?.id}
                  data-highlighted={entry.id === current?.id ? "" : undefined}
                  className="option palette-option"
                  onPointerMove={() => setActiveId(entry.id)}
                  onClick={() => open(entry)}
                >
                  <EntryView entry={entry} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="palette-note t-help" role="status">
        {note}
      </p>
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
