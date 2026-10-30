"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, ViewTransition, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { count } from "@/lib/count";
import { LOCALE, today } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import type { MailRow } from "@/lib/tools/mail-schema";
import { get, post, tool, type Item, type TreeNode } from "../client-api";
import { PageHeader } from "../page-header";
import { AccountFilter, ALL, branchOf, lineOf, MESSAGES, PlaceFilter, placeFromUrl } from "../place-filters";
import { TaskOutcome, useCompleteTask } from "../task-outcome";
import { useTaskReplies, type TaskReplies } from "../task-replies";
import { openTaskDetail, PlaceName, type TaskData } from "../task-row";
import { useChatScope, useWorkspace } from "../workspace";
import { MailViewer } from "./mail-viewer";
import { subjectOf } from "./subject";
import "../../styles/mail.css";

// The mail beside the work: first what arrived for the tasks that wait for mail —each task with its possible replies— and
// the messages linked to an open task, then what is unread, then the rest, each message with its place or its task; the
// message opens beside the list on a computer and over it on a phone. Gmail stays where mail is answered: this page
// correlates, and the person decides which message answers a task.

type Group = { count: number; messages: MailRow[] };
type MailAnswer = {
  accounts: Array<{ id: string; email: string; isDemo: boolean; status: string; nodeId: string | null }>;
  groups: { forTasks: Group; unread: Group; earlier: Group };
  unread: number;
  failures: Array<{ accountId: string; accountEmail: string; reason: string }>;
};
type Account = { id: string; email: string; isDemo: boolean; nodeIds: string[] };
type TasksAnswer = { groups: { overdue: { tasks: TaskData[] }; today: { tasks: TaskData[] }; upcoming: { days: Array<{ tasks: TaskData[] }> }; noDate: { tasks: TaskData[] } } };

const GROUPS = [
  { key: "forTasks", label: "For your tasks" },
  { key: "unread", label: "Unread" },
  { key: "earlier", label: "Earlier" },
] as const;

// How many possible replies each account brings for each task; the task's detail shows more.
const REPLIES = 20;

const keyOf = (row: Pick<MailRow, "accountId" | "id">) => `${row.accountId}:${row.id}`;

// Each message once, in the order it first comes.
function once(rows: MailRow[]): MailRow[] {
  const seen = new Set<string>();
  const kept: MailRow[] = [];
  for (const row of rows) {
    if (seen.has(keyOf(row))) continue;
    seen.add(keyOf(row));
    kept.push(row);
  }
  return kept;
}

export default function MailPage() {
  return (
    <Suspense fallback={null}>
      <Mail />
    </Suspense>
  );
}

const NARROW = "(width < 64rem)";
function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const noSubscription = () => () => {};

// The hour of today's mail, the day of this year's, the whole date of an older one.
function shortWhen(iso: string): string {
  const date = new Date(iso);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (day === today()) return date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

function Mail() {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const { version, tree, refreshTree } = useWorkspace();
  useChatScope(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const place = placeFromUrl(params.get("place"), tree);
  const [mail, setMail] = useState<MailAnswer | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  // What arrived for the tasks that wait for mail, read task by task and account by account; the filters choose among it
  // as among the rest.
  const replies = useTaskReplies({}, mounted ? today() : null, tree, REPLIES);
  // What was opened here since the last read: it reads as read at once and stays where it was until the next read.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // The open message is `message=<account>:<id>`. A box elsewhere opens one with `account=<id>&message=<id>`: there the
  // account names the message, not a filter, so the address is rewritten to the page's own form and the list stays whole.
  const rawMessage = params.get("message");
  const boxAccount = rawMessage && !rawMessage.includes(":") ? params.get("account") : null;
  const selected = rawMessage && boxAccount ? `${boxAccount}:${rawMessage}` : rawMessage;
  useEffect(() => {
    if (!boxAccount || !rawMessage) return;
    const next = new URLSearchParams(params.toString());
    next.delete("account");
    next.set("message", `${boxAccount}:${rawMessage}`);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [boxAccount, rawMessage, params, pathname, router]);

  const set = useCallback(
    (change: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(change)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    let live = true;
    void Promise.all([
      tool<MailAnswer>("list_mail", { limit: 50 }),
      get<{ accounts: Account[] }>("/api/accounts"),
      tool<TasksAnswer>("get_tasks", { today: today() }),
    ]).then(([answer, accountsAnswer, tasksAnswer]) => {
      if (!live) return;
      if (!answer.ok) return setReadError(answer.message);
      setReadError(null);
      setMail(answer);
      setOpened(new Set());
      if (accountsAnswer.ok) setAccounts(accountsAnswer.accounts);
      if (tasksAnswer.ok) {
        const groups = tasksAnswer.groups;
        setTasks([...groups.overdue.tasks, ...groups.today.tasks, ...groups.upcoming.days.flatMap((day) => day.tasks), ...groups.noDate.tasks]);
      }
    });
    return () => {
      live = false;
    };
  }, [version]);

  // A message is in a place when its account hangs from the place or above it (the place sees it), or when it is linked
  // to the place's branch. No account hangs from General.
  const { inPlace, seenFrom } = useMemo(() => {
    const byId = new Map((accounts ?? []).map((account) => [account.id, account]));
    const branches = new Map((tree ?? []).map((node) => [node.id, branchOf(tree, node.id)]));
    const lines = new Map((tree ?? []).map((node) => [node.id, lineOf(tree, node.id)]));
    // Whether a place sees an account: it hangs from the place or above it.
    const seen = (accountId: string, where: string, fallback: string[] = []) => {
      if (where === ALL) return true;
      const line = lines.get(where);
      return Boolean(line) && (byId.get(accountId)?.nodeIds ?? fallback).some((id) => line!.has(id));
    };
    return {
      inPlace: (row: MailRow, where: string) => {
        if (where === ALL) return true;
        const branch = branches.get(where);
        if (branch && row.nodes.some((node) => branch.has(node.id))) return true;
        return seen(row.accountId, where, row.place ? [row.place.nodeId] : []);
      },
      seenFrom: seen,
    };
  }, [accounts, tree]);

  const all = useMemo(
    () =>
      once([
        ...(replies.data?.tasks ?? []).flatMap((entry) => entry.replies),
        ...(mail ? [...mail.groups.forTasks.messages, ...mail.groups.unread.messages, ...mail.groups.earlier.messages] : []),
      ]),
    [mail, replies.data],
  );
  const accountParam = boxAccount ? null : params.get("account");
  const account = accountParam && mail?.accounts.some((entry) => entry.id === accountParam) ? accountParam : ALL;
  const keep = (row: MailRow) => inPlace(row, place) && (account === ALL || row.accountId === account);
  // Each task that waits for mail with what arrived for it in the chosen place and account; a message shows under its task
  // and not again among the unread or the earlier ones.
  const waiting = (replies.data?.tasks ?? [])
    .map((entry) => ({
      ...entry,
      replies: entry.replies.filter(keep),
      more: entry.more.filter((id) => (account === ALL || id === account) && seenFrom(id, place)),
    }))
    .filter((entry) => entry.replies.length > 0);
  const possible = new Set(waiting.flatMap((entry) => entry.replies.map(keyOf)));
  const groups = GROUPS.map((group) => ({ ...group, messages: (mail?.groups[group.key].messages ?? []).filter((row) => keep(row) && !possible.has(keyOf(row))) }));
  const shown = once([...waiting.flatMap((entry) => entry.replies), ...groups.flatMap((group) => group.messages)]);
  const linkedToTasks = groups.find((group) => group.key === "forTasks")?.messages ?? [];
  const forTasks = once([...waiting.flatMap((entry) => entry.replies), ...linkedToTasks]).length;
  const isUnread = (row: MailRow) => row.unread && !opened.has(keyOf(row));
  const unread = shown.filter(isUnread).length;
  // An account that could not be read says so once, whichever read met it.
  const failures = [...(mail?.failures ?? []), ...(replies.data?.tasks ?? []).flatMap((entry) => entry.failures)].filter(
    (failure, index, list) => list.findIndex((other) => other.accountId === failure.accountId) === index,
  );

  const placeCounts = new Map<string, number>([[ALL, all.filter((row) => account === ALL || row.accountId === account).length]]);
  for (const node of tree ?? []) placeCounts.set(node.id, all.filter((row) => inPlace(row, node.id) && (account === ALL || row.accountId === account)).length);
  const accountCounts = new Map<string, number>([[ALL, all.filter((row) => inPlace(row, place)).length]]);
  for (const entry of mail?.accounts ?? []) accountCounts.set(entry.id, all.filter((row) => row.accountId === entry.id && inPlace(row, place)).length);

  const current = selected ? (shown.find((row) => keyOf(row) === selected) ?? all.find((row) => keyOf(row) === selected) ?? null) : null;
  const index = current ? shown.findIndex((row) => keyOf(row) === keyOf(current)) : -1;

  function open(row: MailRow) {
    set({ message: keyOf(row) });
    if (row.unread && !opened.has(keyOf(row))) {
      setOpened((now) => new Set(now).add(keyOf(row)));
      // Gmail is read only here: the product keeps its own mark, and the sidebar's count follows.
      void post("/api/mail/opened", { account: row.accountId, id: row.id }).then(() => void refreshTree());
    }
  }

  // A message the page lands on, from a box or a link, counts as opened here like one pressed in the list.
  const landed = current && current.unread && !opened.has(keyOf(current)) ? current : null;
  useEffect(() => {
    if (!landed) return;
    const key = keyOf(landed);
    void post("/api/mail/opened", { account: landed.accountId, id: landed.id }).then(() => {
      setOpened((now) => new Set(now).add(key));
      void refreshTree();
    });
  }, [landed, refreshTree]);

  if (!mounted) return null;
  const noAccounts = mail !== null && mail.accounts.length === 0;
  const listed = (message: MailRow) => (
    <li key={keyOf(message)}>
      <MailRowView row={message} unread={isUnread(message)} current={current ? keyOf(current) === keyOf(message) : false} onOpen={() => open(message)} />
    </li>
  );
  const viewer = current && (
    <MailViewer
      row={{ ...current, unread: isUnread(current) }}
      onPrevious={index > 0 ? () => open(shown[index - 1]) : null}
      onNext={index >= 0 && index < shown.length - 1 ? () => open(shown[index + 1]) : null}
      onClose={narrow ? () => set({ message: null }) : undefined}
      actions={
        <MailActions
          row={current}
          tree={tree}
          tasks={tasks}
          replies={replies.data?.tasks ?? null}
          isDemo={Boolean(mail?.accounts.find((entry) => entry.id === current.accountId)?.isDemo)}
        />
      }
    />
  );

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page mail-page">
        <PageHeader
          title="Mail"
          count={!mail ? "Reading the mail…" : noAccounts ? "No account connected" : `${unread} unread, ${mail.groups.earlier.count + mail.groups.unread.count + mail.groups.forTasks.count} in all`}
          filters={
            mail && !noAccounts ? (
              <>
                <PlaceFilter value={place} tree={tree} counts={placeCounts} unit={MESSAGES} onChange={(value) => set({ place: value === ALL ? null : value, message: null })} noGeneral />
                <AccountFilter value={account} accounts={mail.accounts} counts={accountCounts} unit={MESSAGES} onChange={(value) => set({ account: value === ALL ? null : value, message: null })} />
              </>
            ) : undefined
          }
          chat
        />

        {readError && (
          <p role="alert" className="inline-note" data-tone="alert">
            The mail could not be read{mail ? " again" : ""}: {readError}.{mail ? " What shows is from the last read." : ""}
          </p>
        )}
        {replies.error && (
          <p role="alert" className="inline-note" data-tone="alert">
            The possible replies of the tasks could not be read{replies.data ? " again" : ""}: {replies.error}.{replies.data ? " What shows is from the last read." : ""}
          </p>
        )}
        {failures.map((failure) => (
          <p key={failure.accountId} role="alert" className="inline-note" data-tone="alert" data-mail-failure>
            The mail of {failure.accountEmail} could not be read: {failure.reason}
          </p>
        ))}

        {noAccounts ? (
          <section className="card mail-empty" aria-labelledby="mail-empty-title">
            <h2 id="mail-empty-title" className="t-title">
              Connect a Google account to see its mail here
            </h2>
            <p className="t-help">Its messages show beside the tasks that wait for them; Gmail stays where they are answered.</p>
            <Link href="/app/settings" className={buttonClass({ variant: "primary" })}>
              <span className="btn-label">Connect Google account</span>
            </Link>
          </section>
        ) : (
          <div className="mail-layout" data-reading={current ? "" : undefined}>
            <section className="card mail-list" aria-label="Messages" aria-busy={!mail}>
              {!mail ? (
                <div className="mail-list-wait" role="status" aria-label="Reading the mail">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className="mail-row-wait">
                      <span className="skeleton" />
                      <span className="skeleton skeleton-title" />
                    </span>
                  ))}
                </div>
              ) : shown.length === 0 ? (
                <p className="t-help mail-none">
                  {place === ALL && account === ALL ? "No mail has arrived in the connected accounts." : "No mail for the chosen place and account."}
                </p>
              ) : (
                groups
                  .filter((group) => group.messages.length > 0 || (group.key === "forTasks" && waiting.length > 0))
                  .map((group) => (
                    <div key={group.key} className="mail-group" role="group" aria-labelledby={`mail-group-${group.key}`}>
                      <h2 id={`mail-group-${group.key}`} className="mail-group-head">
                        <span className="t-label">{group.label}</span>
                        <span className="t-meta">{group.key === "forTasks" ? forTasks : group.messages.length}</span>
                      </h2>
                      {group.key === "forTasks" && waiting.map((entry) => <TaskRepliesGroup key={entry.task.id} entry={entry} listed={listed} />)}
                      {group.messages.length > 0 && <ul className="mail-rows">{group.messages.map(listed)}</ul>}
                    </div>
                  ))
              )}
            </section>
            {!narrow && (
              <section className="card mail-view" aria-label="The open message">
                {viewer ?? (
                  <p className="t-help mail-view-none">{shown.length > 0 ? "Choose a message to read it here." : "A message opens here."}</p>
                )}
              </section>
            )}
          </div>
        )}
        {narrow && <MailSheet open={Boolean(current)} onClose={() => set({ message: null })}>{viewer}</MailSheet>}
      </div>
    </ViewTransition>
  );
}

// A task that waits for mail heads its possible replies; which one answers it, and how it ended, the person says in the
// task or in the open message.
function TaskRepliesGroup({ entry, listed }: { entry: TaskReplies; listed: (message: MailRow) => ReactNode }) {
  const title = inlinePlain(entry.task.title);
  const headId = `mail-task-${entry.task.id}`;
  return (
    <div className="mail-task" role="group" aria-labelledby={headId}>
      <div className="mail-task-head">
        <h3 id={headId} className="mail-task-title">
          <span className="t-meta">{`${count(entry.replies.length, "possible reply", "possible replies")}${entry.more.length > 0 ? " and more" : ""} for`}</span>
          <span className="t-value">{title}</span>
        </h3>
        <Button size="sm" onClick={() => openTaskDetail({ id: entry.task.id })} aria-label={`Open the task “${title}”`}>
          Open the task
        </Button>
      </div>
      <ul className="mail-rows">{entry.replies.map(listed)}</ul>
    </div>
  );
}

// A message in the list: who sent it, its subject, its time, and its place or the open task it is linked to.
function MailRowView({ row, unread, current, onOpen }: { row: MailRow; unread: boolean; current: boolean; onOpen: () => void }) {
  const linked = row.tasks.find((task) => task.status === "open");
  return (
    <button type="button" className="mail-row" data-unread={unread ? "" : undefined} aria-current={current ? "true" : undefined} onClick={onOpen} data-mail-row={keyOf(row)}>
      <span className="mail-row-top">
        <span className="t-name mail-row-from">{row.from.name ?? row.from.email}</span>
        {row.important && (
          <span className="pill" data-tone="warn">
            Important
          </span>
        )}
        <span className="t-meta mail-row-time">{shortWhen(row.receivedAt)}</span>
      </span>
      <span className="mail-row-subject">
        {unread && <span className="sr-only">Unread: </span>}
        {subjectOf(row)}
      </span>
      <span className="t-meta mail-row-where">
        {linked ? (
          <span className="mail-row-for">For: {inlinePlain(linked.title)}</span>
        ) : row.place ? (
          <PlaceName path={row.place.path} color={row.place.color} />
        ) : (
          row.accountEmail
        )}
      </span>
    </button>
  );
}

// The actions on a message: a task that carries it, a link to a task or a place, the waiting task it answers, and Gmail,
// where it is answered.
function MailActions({ row, tree, tasks, replies, isDemo }: { row: MailRow; tree: TreeNode[] | null; tasks: TaskData[]; replies: TaskReplies[] | null; isDemo: boolean }) {
  const { notify, touch, saving } = useWorkspace();
  const closeTask = useCompleteTask();
  // The task this message answers while the person says how it ended; it belongs to the message it was chosen on.
  const [answering, setAnswering] = useState<{ message: string; task: { id: string; title: string } } | null>(null);
  const actions = useRef<HTMLDivElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  // A task picked in «Answers a task…» takes the focus to its result; a menu closed without one gives it back to its button.
  const picked = useRef(false);
  const chosen = answering?.message === keyOf(row) ? answering.task : null;
  const candidates = tasks.filter((task) => task.status === "open" && !row.tasks.some((linked) => linked.id === task.id));
  const nodes = (tree ?? []).filter((node) => !row.nodes.some((linked) => linked.id === node.id));
  const ref = { account: row.accountId, id: row.id };

  async function createTask() {
    const answer = await tool<{ item: Item }>("create_task_from_mail", ref);
    if (!answer.ok) return notify({ text: `The task could not be created: ${answer.message}`, tone: "error" });
    touch();
    const item = answer.item;
    notify({ text: `Added task “${inlinePlain(item.title)}”`, tone: "status", undo: () => void saving(tool("delete_item", { id: item.id })) });
  }
  async function link(target: { task: string } | { node: string }, name: string) {
    const answer = await tool("link_mail", { ...ref, ...target });
    if (!answer.ok) return notify({ text: `The message could not be linked: ${answer.message}`, tone: "error" });
    touch();
    notify({ text: `Linked the message to ${name}`, tone: "status", undo: () => void saving(tool("unlink_mail", { ...ref, ...target })) });
  }
  async function unlink(target: { task: string } | { node: string }, name: string) {
    const answer = await tool("unlink_mail", { ...ref, ...target });
    if (!answer.ok) return notify({ text: `The link could not be taken off: ${answer.message}`, tone: "error" });
    touch();
    notify({ text: `Took the message off ${name}`, tone: "status", undo: () => void saving(tool("link_mail", { ...ref, ...target })) });
  }
  async function answer(task: { id: string; title: string }, result: string) {
    if (await closeTask(task, row, result)) setAnswering(null);
  }
  // Leaving the choice puts the focus back on «Answers a task…».
  function stopAnswering() {
    setAnswering(null);
    requestAnimationFrame(() => actions.current?.querySelector<HTMLElement>(".mail-answers-menu")?.focus());
  }

  const entries: MenuEntry[] = [
    {
      kind: "submenu",
      label: "A task",
      entries: candidates.length
        ? candidates
            .slice(0, 40)
            .map((task): MenuEntry => ({ kind: "action", id: task.id, label: inlinePlain(task.title), detail: task.path ?? "General", onSelect: () => void link({ task: task.id }, `“${inlinePlain(task.title)}”`) }))
        : [{ kind: "action", label: "No open task to link", disabled: true, onSelect: () => undefined }],
    },
    {
      kind: "submenu",
      label: "A client or project",
      entries: nodes.length
        ? nodes.map((node): MenuEntry => ({ kind: "action", label: node.path, onSelect: () => void link({ node: node.id }, node.path) }))
        : [{ kind: "action", label: "Linked to every client and project", disabled: true, onSelect: () => undefined }],
    },
  ];
  // The open tasks that wait for mail, first those this message is a possible reply of.
  const waiting = tasks.filter((task) => task.status === "open" && task.mail);
  const replyOf = new Set((replies ?? []).filter((entry) => entry.replies.some((reply) => keyOf(reply) === keyOf(row))).map((entry) => entry.task.id));
  const answerEntry = (task: TaskData): MenuEntry => ({
    kind: "action",
    id: task.id,
    label: inlinePlain(task.title),
    detail: task.path ?? "General",
    onSelect: () => {
      picked.current = true;
      setAnswering({ message: keyOf(row), task: { id: task.id, title: task.title } });
    },
  });
  const first = waiting.filter((task) => replyOf.has(task.id));
  const rest = waiting.filter((task) => !replyOf.has(task.id));
  const answers: MenuEntry[] =
    waiting.length === 0
      ? [{ kind: "action", label: "No task waits for mail: set it in a task's detail", disabled: true, onSelect: () => undefined }]
      : [
          ...(first.length > 0 ? [{ kind: "group" as const, label: "This message is a possible reply of", entries: first.map(answerEntry) }] : []),
          ...(rest.length > 0 ? [{ kind: "group" as const, label: first.length > 0 ? "Other tasks that wait for mail" : "Tasks that wait for mail", entries: rest.map(answerEntry) }] : []),
        ];
  const gmail = `https://mail.google.com/mail/?authuser=${encodeURIComponent(row.accountEmail)}#all/${encodeURIComponent(row.threadId || row.id)}`;

  return (
    <>
      <div ref={actions} className="mail-action-row">
        <Button size="sm" variant="primary" onClick={() => void createTask()}>
          Create task
        </Button>
        <Menu label="Link to…" name={`Link to… “${row.subject}”`} entries={entries} className="mail-link-menu" />
        <Menu
          label="Answers a task…"
          name={`Answers a task… “${row.subject}”`}
          entries={answers}
          className="mail-answers-menu"
          finalFocus={() => {
            const target = picked.current ? outcome.current?.querySelector<HTMLElement>("button") : null;
            picked.current = false;
            return target;
          }}
        />
        {isDemo ? (
          <Button size="sm" disabled aria-describedby="mail-gmail-why">
            Open in Gmail
          </Button>
        ) : (
          <a className={buttonClass({ size: "sm" })} href={gmail} target="_blank" rel="noopener noreferrer">
            <span className="btn-label">Open in Gmail</span>
          </a>
        )}
      </div>
      {isDemo && (
        <p id="mail-gmail-why" className="t-help mail-why">
          A sample account has no Gmail to open: its messages live only in this demo.
        </p>
      )}
      {chosen && (
        <div ref={outcome}>
          <TaskOutcome
            key={chosen.id}
            question={`How did “${inlinePlain(chosen.title)}” end?`}
            title={chosen.title}
            onClose={(result) => answer(chosen, result)}
            onCancel={stopAnswering}
          />
        </div>
      )}
      {(row.tasks.length > 0 || row.nodes.length > 0) && (
        <ul className="mail-linked" aria-label="What the message is linked to">
          {row.tasks.map((task) => (
            <li key={`task-${task.id}`} className="mail-linked-row">
              <button type="button" className="mail-linked-open" onClick={() => openTaskDetail({ id: task.id })}>
                <span className="t-meta">Linked to the task</span>
                <span className="t-value">{inlinePlain(task.title)}</span>
              </button>
              <Button size="sm" variant="quiet" onClick={() => void unlink({ task: task.id }, `“${inlinePlain(task.title)}”`)} aria-label={`Take the message off “${inlinePlain(task.title)}”`}>
                Take off
              </Button>
            </li>
          ))}
          {row.nodes.map((node) => (
            <li key={`node-${node.id}`} className="mail-linked-row">
              <Link href={`/app/node/${node.id}`} className="mail-linked-open">
                <span className="t-meta">Linked to</span>
                <span className="t-value">{node.path}</span>
              </Link>
              <Button size="sm" variant="quiet" onClick={() => void unlink({ node: node.id }, node.path)} aria-label={`Take the message off ${node.path}`}>
                Take off
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// On a phone the message opens over the list, as a sheet of the whole screen with its way back.
function MailSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kept, setKept] = useState<ReactNode>(children);
  if (children && children !== kept) setKept(children);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog mail-sheet" aria-label="The open message" onClose={onClose}>
      <PopupLayerProvider container={ref}>
        <div className="mail-sheet-in">{children ?? kept}</div>
      </PopupLayerProvider>
    </dialog>
  );
}
