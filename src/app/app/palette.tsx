"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { DecisionIcon, MailIcon, NextIcon, NoteIcon, SearchIcon, TasksIcon } from "@/components/ui/icons";
import { count } from "@/lib/count";
import { prepare, rank } from "@/lib/fuzzy";
import { inlinePlain } from "@/lib/inline-links";
import { mailFailureText } from "@/lib/mail/failure-text";
import type { MailRow } from "@/lib/tools/mail-schema";
import { currentTheme, setTheme } from "@/lib/theme";
import { tool, type Item, type TreeNode } from "./client-api";
import { requestFocus, type FocusTarget } from "./focus-request";
import { TYPE_NAMES } from "./item-parts";
import { subjectOf } from "./mail/subject";
import { openQuickAdd } from "./quick-add-bus";
import type { MailFailureRow } from "./mail-store";
import { useWorkspace } from "./workspace";

type Entry =
  | { kind: "node"; id: string; node: TreeNode }
  | { kind: "item"; id: string; item: Item }
  | { kind: "mail"; id: string; row: MailRow }
  | { kind: "action"; id: string; label: string; run: () => void };

const KIND_NAMES: Record<TreeNode["kind"], string> = { client: "Client", project: "Project", subproject: "Subproject" };
const LIMIT = { node: 6, item: 8, mail: 8 };

const MAIL_WAIT_MS = 400;
const NAME = "Search clients, projects, tasks, mail, and actions";





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
      aria-label={NAME}
      onClose={onClose}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) onClose();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      {open && <PaletteBody onClose={onClose} />}
    </dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const { tree, treeError, refreshTree, mailAccounts } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const currentNode = pathname.match(/^\/app\/node\/([0-9a-f-]{36})/)?.[1] ?? null;
  const here = tree?.find((node) => node.id === currentNode);

  
  
  
  const treeRead = tree !== null;
  const rootIds = (tree ?? [])
    .filter((node) => node.parentId === null)
    .map((node) => node.id)
    .join(",");
  useEffect(() => {
    if (!treeRead && treeError) void refreshTree();
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!treeRead) return;
    let live = true;
    const roots = rootIds ? rootIds.split(",") : [];
    void Promise.all(roots.map((id) => tool<{ items: Item[] }>("list_items", { node: id, status: "all", includeSubprojects: true }))).then((answers) => {
      if (!live) return;
      setItemsFailed(answers.some((answer) => !answer.ok));
      setItems(answers.flatMap((answer) => (answer.ok ? answer.items : [])));
    });
    return () => {
      live = false;
    };
  }, [rootIds, treeRead]);

  
  
  const words = query.trim();
  const [mail, setMail] = useState<{ words: string; rows: MailRow[]; failures: MailFailureRow[]; waiting: number }>({ words: "", rows: [], failures: [], waiting: 0 });
  useEffect(() => {
    const accounts = mailAccounts ?? [];
    if (!words || accounts.length === 0) return;
    let live = true;
    const timer = setTimeout(() => {
      setMail({ words, rows: [], failures: [], waiting: accounts.length });
      for (const account of accounts) {
        void tool<{ mail: MailRow[]; failures: MailFailureRow[] }>("search_mail", { account: account.id, query: words }).then((answer) => {
          if (!live) return;
          setMail((now) => ({
            words,
            rows: answer.ok ? [...now.rows, ...answer.mail].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)) : now.rows,
            failures: [...now.failures, ...(answer.ok ? answer.failures : [{ accountId: account.id, accountEmail: account.email, reason: answer.message }])],
            waiting: now.waiting - 1,
          }));
        });
      }
    }, MAIL_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [words, mailAccounts]);
  const mailNow = useMemo(() => (mail.words === words && words ? mail : { words, rows: [], failures: [], waiting: 0 }), [mail, words]);
  const mailRows = mailNow.rows;

  const actions = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      { kind: "action", id: "go-overview", label: "Go to the Overview", run: () => router.push("/app") },
      { kind: "action", id: "go-calendar", label: "Go to the Calendar", run: () => router.push("/app/calendar") },
      { kind: "action", id: "go-settings", label: "Go to Settings", run: () => router.push("/app/settings") },
    ];
    if (here) {
      list.push({ kind: "action", id: "new-task", label: `New task in ${here.name}`, run: () => openQuickAdd({ placeId: here.id }) });
      list.push({ kind: "action", id: "agent", label: `Issue an agent token for ${here.name}`, run: () => router.push(`/app/settings?node=${here.id}#agent-tokens`) });
    }
    const dark = currentTheme() === "dark";
    list.push({ kind: "action", id: "theme", label: dark ? "Switch to the light theme" : "Switch to the dark theme", run: () => setTheme(dark ? "light" : "dark") });
    return list;
  }, [here, router]);

  
  
  function go(target: FocusTarget) {
    requestFocus(target);
    if (pathname !== `/app/node/${target.nodeId}`) router.push(`/app/node/${target.nodeId}`);
  }

  
  const nodeIndex = useMemo(() => (tree ?? []).map((node) => ({ node, prepared: prepare(`${node.name} ${node.path}`) })), [tree]);
  const itemIndex = useMemo(() => (items ?? []).map((item) => ({ item, prepared: prepare(`${item.title} ${item.body ?? ""}`) })), [items]);
  const actionIndex = useMemo(() => actions.map((action) => ({ action, prepared: prepare(action.kind === "action" ? action.label : "") })), [actions]);

  const groups = useMemo(() => {
    const q = query.trim();
    const nodeHits = q ? rank(q, nodeIndex, (hit) => hit.prepared).slice(0, LIMIT.node).map((hit) => hit.entry.node) : (tree ?? []).slice(0, LIMIT.node);
    const itemHits = q ? rank(q, itemIndex, (hit) => hit.prepared).slice(0, LIMIT.item).map((hit) => hit.entry.item) : [];
    const actionHits = q ? rank(q, actionIndex, (hit) => hit.prepared).map((hit) => hit.entry.action) : actions;
    return [
      { key: "projects", name: "Clients and projects", entries: nodeHits.map((node): Entry => ({ kind: "node", id: `node-${node.id}`, node })) },
      { key: "items", name: "Tasks and notes", entries: itemHits.map((item): Entry => ({ kind: "item", id: `item-${item.id}`, item })) },
      { key: "mail", name: "Mail", entries: mailRows.slice(0, LIMIT.mail).map((row): Entry => ({ kind: "mail", id: `mail-${row.accountId}-${row.id}`, row })) },
      { key: "actions", name: "Actions", entries: actionHits },
    ].filter((group) => group.entries.length > 0);
  }, [query, tree, nodeIndex, itemIndex, actionIndex, actions, mailRows]);

  
  
  const flat = groups.flatMap((group) => group.entries);
  const current = activeId === null ? flat[0] : (flat.find((entry) => entry.id === activeId) ?? null);

  useEffect(() => {
    if (!current) return;
    list.current?.querySelector(`#palette-${CSS.escape(current.id)}`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function open(entry: Entry) {
    onClose();
    if (entry.kind === "node") go({ kind: "node", nodeId: entry.node.id });
    else if (entry.kind === "item") {
      
      if (entry.item.nodeId) go({ kind: "item", nodeId: entry.item.nodeId, itemId: entry.item.id, title: entry.item.title, type: entry.item.type, done: entry.item.status === "done" });
    } else if (entry.kind === "mail") router.push(`/app/mail?account=${encodeURIComponent(entry.row.accountId)}&message=${encodeURIComponent(entry.row.id)}`);

    else requestAnimationFrame(entry.run);
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
  
  const accountsSearching = !words ? 0 : mail.words === words ? mailNow.waiting : (mailAccounts?.length ?? 0);
  const treeFailed = !treeRead && treeError !== null;
  const nothing = flat.length === 0 && accountsSearching === 0;
  
  
  const note = treeFailed
    ? `Clients, projects, tasks and mail could not be read: ${treeError.replace(/\.+$/, "")}. Actions still work; open this again to retry.`
    : searching && (items === null || mailAccounts === null)
      ? "Reading tasks and notes…"
      : nothing && itemsFailed
        ? `Some tasks and notes could not be read, and nothing else matches “${query.trim()}”.`
        : nothing && mailNow.failures.length > 0
          ? `Nothing matches “${query.trim()}” in what could be searched.`
          : nothing
            ? `Nothing matches “${query.trim()}”. Try fewer letters or another word.`
            : itemsFailed
              ? "Some tasks and notes could not be read; projects and actions still work."
              : accountsSearching > 0
                ? `Searching the mail of ${count(accountsSearching, "account", "accounts")}…`
                : "";
  const noteFailed = treeFailed || itemsFailed;
  return (
    <div className="palette-inner">
      <div className="palette-search">
        <SearchIcon className="palette-search-icon" />
        <input
          autoFocus
          id="palette-search"
          name="palette-search"
          className="field"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={flat.length > 0 ? "palette-list" : undefined}
          aria-autocomplete="list"
          aria-activedescendant={current ? `palette-${current.id}` : undefined}
          aria-label={NAME}
          placeholder={NAME}
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
      <p className={noteFailed ? "palette-note inline-note" : "palette-note t-help"} data-tone={noteFailed ? "alert" : undefined} role="status">
        {note}
      </p>
      {mailNow.failures.map((failure) => (
        <p key={failure.accountId} className="palette-note t-help" data-mail-failure>
          {`Not searched: ${mailFailureText(failure)}`}
        </p>
      ))}
      <p className="palette-foot t-meta">
        <span className="palette-keys">
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> Move
        </span>
        <span className="palette-keys">
          <kbd className="kbd">↵</kbd> Open
        </span>
        <span className="palette-keys">
          <kbd className="kbd">Esc</kbd> Close
        </span>
      </p>
    </div>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === "node") {
    return (
      <>
        <span className="palette-icon" data-color={entry.node.color ?? undefined} aria-hidden="true">
          <span className="palette-dot" />
        </span>
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
        <span className="palette-icon" aria-hidden="true">
          {item.type === "task" ? <TasksIcon /> : item.type === "decision" ? <DecisionIcon /> : <NoteIcon />}
        </span>
        <span className="pill" data-tone={item.status === "done" ? undefined : "accent"}>
          {item.status === "done" ? "Done" : TYPE_NAMES[item.type]}
        </span>
        <span className="stack palette-text">
          {}
          <span className="t-value">{inlinePlain(item.title)}</span>
          <span className="t-meta">{item.nodePath}</span>
        </span>
      </>
    );
  }
  if (entry.kind === "mail") {
    return (
      <>
        <span className="palette-icon" aria-hidden="true">
          <MailIcon />
        </span>
        <span className="pill">Mail</span>
        <span className="stack palette-text">
          <span className="t-value">{subjectOf(entry.row)}</span>
          <span className="t-meta">{`${entry.row.from.name ?? entry.row.from.email} · ${entry.row.accountEmail}`}</span>
        </span>
      </>
    );
  }
  return (
    <>
      <span className="palette-icon" aria-hidden="true">
        <NextIcon />
      </span>
      <span className="pill" data-tone="info">
        Action
      </span>
      <span className="t-value">{entry.label}</span>
    </>
  );
}
