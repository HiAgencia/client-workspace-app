"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { DecisionIcon, MailIcon, NextIcon, NoteIcon, SearchIcon, TasksIcon } from "@/components/ui/icons";
import { useAutoHeight } from "@/components/ui/use-auto-height";
import { focusAfterClose, handBack, takesFocus, useExit } from "@/components/ui/use-exit";
import { useMedia } from "@/components/ui/use-media";
import { prepare, rank } from "@/lib/fuzzy";
import { inlinePlain } from "@/lib/inline-links";
import { setLanguage } from "@/lib/language";
import { mailFailureText } from "@/lib/mail/failure-text";
import { useStrings, type StringKey } from "@/lib/strings";
import type { MailRow } from "@/lib/tools/mail-schema";
import { currentTheme, setTheme } from "@/lib/theme";
import { tool, type Item, type TreeNode } from "./client-api";
import { requestFocus, type FocusTarget } from "./focus-request";
import { PathText, typeName } from "./item-parts";
import { subjectOf } from "./mail/subject";
import { openQuickAdd } from "./quick-add-bus";
import type { MailFailureRow } from "./mail-store";
import { showShortcuts } from "./shortcuts";
import { menuButton, useWorkspace } from "./workspace";

type Entry =
  | { kind: "node"; id: string; node: TreeNode }
  | { kind: "item"; id: string; item: Item }
  | { kind: "mail"; id: string; row: MailRow }
  | { kind: "action"; id: string; label: string; name?: string; run: () => void };

const KIND_NAMES: Record<TreeNode["kind"], StringKey> = { client: "kind.client", project: "kind.project", subproject: "kind.subproject" };
const LIMIT = { node: 6, item: 8, mail: 8 };
const MAIL_WAIT_MS = 400;
const NARROW = "(width < 36rem)";
const TOUCH = "(pointer: coarse)";

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useStrings();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement as HTMLElement | null;
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);
  const shown = useExit(open, dialog);
  return (
    <dialog
      ref={dialog}
      className="dialog palette"
      aria-label={t("palette.name")}
      onClose={() => {
        if (!takesFocus(opener.current)) focusAfterClose(handBack(opener.current, menuButton), opener.current);
        onClose();
      }}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) onClose();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      {shown && <PaletteBody dialog={dialog} onClose={onClose} />}
    </dialog>
  );
}

function PaletteBody({ dialog, onClose }: { dialog: RefObject<HTMLDialogElement | null>; onClose: () => void }) {
  const { t, lang, counted } = useStrings();
  const { tree, treeError, refreshTree, mailAccounts, person, switchAccount } = useWorkspace();
  const signedIn = person !== null && !person.isAnonymous;
  const router = useRouter();
  const pathname = usePathname();
  const narrow = useMedia(NARROW);
  const touch = useMedia(TOUCH);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useAutoHeight(dialog, inner);
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
      { kind: "action", id: "go-overview", label: t("palette.goOverview"), run: () => router.push("/app") },
      { kind: "action", id: "go-tasks", label: t("palette.goTasks"), run: () => router.push("/app/tasks") },
      { kind: "action", id: "go-calendar", label: t("palette.goCalendar"), run: () => router.push("/app/calendar") },
      { kind: "action", id: "go-mail", label: t("palette.goMail"), run: () => router.push("/app/mail") },
      { kind: "action", id: "go-trash", label: t("palette.goTrash"), run: () => router.push("/app/trash") },
      { kind: "action", id: "go-settings", label: t("palette.goSettings"), run: () => router.push("/app/settings") },
    ];
    if (signedIn) {
      list.push({ kind: "action", id: "go-profile", label: t("palette.goProfile"), run: () => router.push("/app/profile") });
      list.push({ kind: "action", id: "switch-account", label: t("palette.switchAccount"), run: () => void switchAccount() });
    }
    if (here) {
      list.push({ kind: "action", id: "new-task", label: t("palette.newTaskIn", { name: here.name }), run: () => openQuickAdd({ placeId: here.id }) });
      list.push({ kind: "action", id: "agent", label: t("palette.agentTokenFor", { name: here.name }), run: () => router.push(`/app/settings?node=${here.id}#agent-tokens`) });
    }
    const dark = currentTheme() === "dark";
    list.push({ kind: "action", id: "theme", label: dark ? t("palette.toLight") : t("palette.toDark"), run: () => setTheme(dark ? "light" : "dark") });
    list.push(
      lang === "en"
        ? { kind: "action", id: "language", label: t("language.spanish"), name: t("language.switchToSpanish"), run: () => setLanguage("es") }
        : { kind: "action", id: "language", label: t("language.english"), name: t("language.switchToEnglish"), run: () => setLanguage("en") },
    );
    if (!touch) list.push({ kind: "action", id: "shortcuts", label: t("palette.shortcuts"), run: showShortcuts });
    return list;
  }, [here, router, signedIn, switchAccount, touch, lang, t]);

  function go(target: FocusTarget) {
    requestFocus(target);
    if (pathname !== `/app/node/${target.nodeId}`) router.push(`/app/node/${target.nodeId}`);
  }

  const nodeIndex = useMemo(() => (tree ?? []).map((node) => ({ node, prepared: prepare(`${node.name} ${node.path}`) })), [tree]);
  const itemIndex = useMemo(() => (items ?? []).map((item) => ({ item, prepared: prepare(`${item.title} ${item.body ?? ""}`) })), [items]);
  const actionIndex = useMemo(() => actions.map((action) => ({ action, prepared: prepare(action.kind === "action" ? `${action.label} ${action.name ?? ""}` : "") })), [actions]);

  const tops = useMemo(() => {
    const roots = (tree ?? []).filter((node) => node.parentId === null);
    return [...roots.filter((node) => node.kind === "client"), ...roots.filter((node) => node.kind !== "client")];
  }, [tree]);

  const groups = useMemo(() => {
    const q = query.trim();
    const nodeHits = q ? rank(q, nodeIndex, (hit) => hit.prepared).slice(0, LIMIT.node).map((hit) => hit.entry.node) : tops;
    const itemHits = q ? rank(q, itemIndex, (hit) => hit.prepared).slice(0, LIMIT.item).map((hit) => hit.entry.item) : [];
    const actionHits = q ? rank(q, actionIndex, (hit) => hit.prepared).map((hit) => hit.entry.action) : actions;
    return [
      { key: "projects", name: t("palette.clientsProjects"), entries: nodeHits.map((node): Entry => ({ kind: "node", id: `node-${node.id}`, node })) },
      { key: "items", name: t("palette.tasksNotes"), entries: itemHits.map((item): Entry => ({ kind: "item", id: `item-${item.id}`, item })) },
      { key: "mail", name: t("palette.mail"), entries: mailRows.slice(0, LIMIT.mail).map((row): Entry => ({ kind: "mail", id: `mail-${row.accountId}-${row.id}`, row })) },
      { key: "actions", name: t("palette.actions"), entries: actionHits },
    ].filter((group) => group.entries.length > 0);
  }, [query, tops, nodeIndex, itemIndex, actionIndex, actions, mailRows, t]);

  const flat = groups.flatMap((group) => group.entries);
  const current = activeId === null ? (touch && !query.trim() ? null : flat[0]) : (flat.find((entry) => entry.id === activeId) ?? null);

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
    ? t("palette.loadFailed", { reason: treeError.replace(/\.+$/, "") })
    : searching && (items === null || mailAccounts === null)
      ? t("palette.loadingTasks")
      : nothing && itemsFailed
        ? t("palette.someNotLoadedNothing", { query: query.trim() })
        : nothing && mailNow.failures.length > 0
          ? t("palette.nothingInSearched", { query: query.trim() })
          : nothing
            ? t("palette.nothingMatches", { query: query.trim() })
            : itemsFailed
              ? t("palette.someNotLoaded")
              : accountsSearching > 0
                ? t("palette.searchingMail", { what: counted(accountsSearching, "counted.account", "counted.accounts") })
                : "";
  const noteFailed = treeFailed || itemsFailed;
  return (
    <div ref={inner} className="palette-inner" data-cascade>
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
          aria-label={t("palette.name")}
          placeholder={narrow ? t("palette.shortName") : t("palette.name")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
          onKeyDown={onKey}
        />
      </div>
      {flat.length > 0 && (
        <div className="palette-list" id="palette-list" role="listbox" aria-label={t("palette.results")} ref={list}>
          {groups.map((group) => (
            <div key={group.key} role="group" aria-labelledby={`palette-group-${group.key}`}>
              <div id={`palette-group-${group.key}`} role="presentation" className="palette-group-label">
                {group.name}
              </div>
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  id={`palette-${entry.id}`}
                  role="option"
                  aria-label={entry.kind === "action" ? entry.name ?? entry.label : undefined}
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
      <p className="sr-only" role="status">
        {searching && !note && flat.length > 0 ? t("palette.resultsFor", { what: counted(flat.length, "counted.result", "counted.results"), query: words }) : ""}
      </p>
      {mailNow.failures.map((failure) => (
        <p key={failure.accountId} className="palette-note t-help" data-mail-failure>
          {t("palette.notSearched", { what: mailFailureText(failure) })}
        </p>
      ))}
      <p className="palette-foot t-meta">
        <span className="palette-keys">
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> {t("palette.move")}
        </span>
        <span className="palette-keys">
          <kbd className="kbd">↵</kbd> {t("palette.open")}
        </span>
        <span className="palette-keys">
          <kbd className="kbd">Esc</kbd> {t("palette.close")}
        </span>
      </p>
    </div>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  const { t } = useStrings();
  if (entry.kind === "node") {
    return (
      <>
        <span className="palette-icon" data-color={entry.node.color ?? undefined} aria-hidden="true">
          <span className="palette-dot" />
        </span>
        <span className="pill">{t(KIND_NAMES[entry.node.kind])}</span>
        <span className="stack palette-text">
          <span className="t-name">{entry.node.name}</span>
          {entry.node.path !== entry.node.name && <span className="t-meta">{entry.node.path.slice(0, entry.node.path.lastIndexOf(" / "))}</span>}
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
          {item.status === "done" ? t("palette.done") : typeName(item.type)}
        </span>
        <span className="stack palette-text">
          <span className="t-value">{inlinePlain(item.title)}</span>
          {item.nodePath && <span className="t-meta"><PathText path={item.nodePath} /></span>}
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
        <span className="pill">{t("palette.mail")}</span>
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
        {t("palette.action")}
      </span>
      <span className="t-value">{entry.label}</span>
    </>
  );
}
