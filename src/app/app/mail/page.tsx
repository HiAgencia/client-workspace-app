"use client";

import { Link } from "@/components/ui/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, ViewTransition, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { AddIcon, ExternalIcon } from "@/components/ui/icons";
import { Field } from "@/components/ui/field";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { useMedia } from "@/components/ui/use-media";
import { count } from "@/lib/count";
import { LOCALE, today } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { mailFailureText } from "@/lib/mail/failure-text";
import { repliesText } from "@/lib/mail/replies-text";
import type { MailRow } from "@/lib/tools/mail-schema";
import { useMailRead } from "../box-kinds";
import { post, tool, type Item, type TreeNode } from "../client-api";
import { accountsSeenFrom, figureWords } from "../mail-store";
import { PageHeader } from "../page-header";
import { AccountFilter, ALL, branchOf, MESSAGES, PlaceFilter, placeFromUrl } from "../place-filters";
import { TaskOutcome, useCompleteTask } from "../task-outcome";
import { useTaskReplies, type TaskReplies } from "../task-replies";
import { openTaskDetail, PlaceName, type TaskData } from "../task-row";
import { useChatScope, useWorkspace } from "../workspace";
import { tasksMatching } from "./link-task";
import { MAIL_PHONE, MailViewer, useMailMode } from "./mail-viewer";
import { subjectOf, taskLine } from "./subject";
import "../../styles/mail.css";






type TasksAnswer = { groups: { overdue: { tasks: TaskData[] }; today: { tasks: TaskData[] }; upcoming: { days: Array<{ tasks: TaskData[] }> }; noDate: { tasks: TaskData[] } } };

const GROUPS = [
  { key: "forTasks", label: "For your tasks" },
  { key: "unread", label: "Unread" },
  { key: "earlier", label: "Earlier" },
] as const;


const REPLIES = 20;


const LIST_WAIT = 4000;
const PURPOSE = "What may answer your tasks, then what is unread.";

const keyOf = (row: Pick<MailRow, "accountId" | "id">) => `${row.accountId}:${row.id}`;


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

const noSubscription = () => () => {};


function shortWhen(iso: string): string {
  const date = new Date(iso);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (day === today()) return date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

function Mail() {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const narrow = useMedia("(width < 64rem)");
  const { version, tree, mailAccounts, mailStore } = useWorkspace();
  useChatScope(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const place = placeFromUrl(params.get("place"), tree);
  
  const read = useMailRead({ kind: "all" }, null);
  const mail = read.data;
  const readError = read.error;
  const [tasks, setTasks] = useState<TaskData[]>([]);
  
  
  const replies = useTaskReplies({}, mounted ? today() : null, tree, REPLIES);
  
  const [revealed, setRevealed] = useState(false);
  const repliesRead = replies.data !== null || replies.error !== null;
  const readWhole = mail !== null && mail.waiting === 0 && repliesRead;
  if (readWhole && !revealed) setRevealed(true);
  const holding = mail !== null && !revealed;
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setRevealed(true), LIST_WAIT);
    return () => clearTimeout(timer);
  }, [holding]);
  
  
  const [opened, setOpened] = useState<Set<string>>(new Set());
  
  
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
    void tool<TasksAnswer>("get_tasks", { today: today() }).then((tasksAnswer) => {
      if (!live || !tasksAnswer.ok) return;
      const groups = tasksAnswer.groups;
      setTasks([...groups.overdue.tasks, ...groups.today.tasks, ...groups.upcoming.days.flatMap((day) => day.tasks), ...groups.noDate.tasks]);
    });
    return () => {
      live = false;
    };
  }, [version]);

  
  
  const { inPlace, seenFrom } = useMemo(() => {
    const branches = new Map((tree ?? []).map((node) => [node.id, branchOf(tree, node.id)]));
    const sees = new Map((tree ?? []).map((node) => [node.id, new Set(accountsSeenFrom(tree, mailAccounts ?? [], node.id))]));
    const seen = (accountId: string, where: string) => where === ALL || Boolean(sees.get(where)?.has(accountId));
    return {
      inPlace: (row: MailRow, where: string) => {
        if (where === ALL) return true;
        const branch = branches.get(where);
        if (branch && row.nodes.some((node) => branch.has(node.id))) return true;
        return seen(row.accountId, where);
      },
      seenFrom: seen,
    };
  }, [mailAccounts, tree]);

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
  
  
  const waiting = (replies.data?.tasks ?? [])
    .map((entry) => ({
      ...entry,
      replies: entry.replies.filter(keep),
      more: entry.more.filter((id) => (account === ALL || id === account) && seenFrom(id, place)),
    }))
    .filter((entry) => entry.replies.length > 0);
  const possible = new Set(waiting.flatMap((entry) => entry.replies.map(keyOf)));
  
  const toDone = mail ? [...mail.groups.unread.messages, ...mail.groups.earlier.messages].filter((row) => row.tasks.length > 0) : [];
  const groups = GROUPS.map((group) => {
    const own = mail?.groups[group.key].messages ?? [];
    const messages = group.key === "forTasks" ? [...own, ...toDone] : own.filter((row) => row.tasks.length === 0);
    return { ...group, messages: messages.filter((row) => keep(row) && !possible.has(keyOf(row))) };
  });
  const shown = once([...waiting.flatMap((entry) => entry.replies), ...groups.flatMap((group) => group.messages)]);
  const linkedToTasks = groups.find((group) => group.key === "forTasks")?.messages ?? [];
  const forTasks = once([...waiting.flatMap((entry) => entry.replies), ...linkedToTasks]).length;
  const isUnread = (row: MailRow) => row.unread && !opened.has(keyOf(row));
  
  const failures = [...(mail?.failures ?? []), ...(replies.data?.tasks ?? []).flatMap((entry) => entry.failures)].filter(
    (failure, index, list) => list.findIndex((other) => other.accountId === failure.accountId) === index,
  );

  const placeCounts = new Map<string, number>([[ALL, all.filter((row) => account === ALL || row.accountId === account).length]]);
  for (const node of tree ?? []) placeCounts.set(node.id, all.filter((row) => inPlace(row, node.id) && (account === ALL || row.accountId === account)).length);
  const accountCounts = new Map<string, number>([[ALL, all.filter((row) => inPlace(row, place)).length]]);
  for (const entry of mail?.accounts ?? []) accountCounts.set(entry.id, all.filter((row) => row.accountId === entry.id && inPlace(row, place)).length);

  const listedRow = selected ? (shown.find((row) => keyOf(row) === selected) ?? all.find((row) => keyOf(row) === selected) ?? null) : null;
  
  
  const [apart, setApart] = useState<{ key: string; row: MailRow | null; error: string | null } | null>(null);
  const listsDone = mail !== null && mail.waiting === 0;
  useEffect(() => {
    if (!selected?.includes(":") || listedRow || !listsDone) return;
    const at = selected.indexOf(":");
    let live = true;
    void tool<{ message: MailRow }>("get_mail", { account: selected.slice(0, at), id: selected.slice(at + 1) }).then((answer) => {
      if (live) setApart({ key: selected, row: answer.ok ? answer.message : null, error: answer.ok ? null : answer.message });
    });
    return () => {
      live = false;
    };
  }, [selected, Boolean(listedRow), listsDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const apartHere = apart?.key === selected && !listedRow ? apart : null;
  const current = listedRow ?? apartHere?.row ?? null;
  const index = current ? shown.findIndex((row) => keyOf(row) === keyOf(current)) : -1;
  
  
  const seenHere = mail ? mail.accounts.filter((entry) => (account === ALL || entry.id === account) && seenFrom(entry.id, place)) : [];
  const figure = mail ? mailStore.figure(seenHere) : null;
  const unreadApart = shown.filter((row) => isUnread(row) && !seenHere.some((entry) => entry.id === row.accountId)).length;
  const unreadWords = figureWords(figure && { ...figure, unread: figure.unread + unreadApart });

  
  const countAgain = useCallback(
    (accountId: string) => {
      const account = mailAccounts?.find((entry) => entry.id === accountId);
      if (account) mailStore.recount(account);
    },
    [mailAccounts, mailStore],
  );

  function open(row: MailRow) {
    set({ message: keyOf(row) });
    if (row.unread && !opened.has(keyOf(row))) {
      setOpened((now) => new Set(now).add(keyOf(row)));
      void post("/api/mail/opened", { account: row.accountId, id: row.id }).then(() => countAgain(row.accountId));
    }
  }

  
  
  const newest = (rows: MailRow[]) => rows.reduce<MailRow | null>((best, row) => (!best || Date.parse(row.receivedAt) > Date.parse(best.receivedAt) ? row : best), null);
  const newestReply = newest(waiting.flatMap((entry) => entry.replies));
  const newestUnread = newest(shown.filter(isUnread));
  const offered: { row: MailRow; label: string } | null = !revealed
    ? null
    : newestReply
      ? { row: newestReply, label: "Read the newest possible reply" }
      : newestUnread
        ? { row: newestUnread, label: "Read the newest unread" }
        : shown.length > 0
          ? { row: newest(shown) as MailRow, label: "Read the newest message" }
          : null;
  
  const focusSubject = useRef(false);
  const currentKey = current ? keyOf(current) : null;
  useEffect(() => {
    if (!focusSubject.current || !currentKey) return;
    focusSubject.current = false;
    document.getElementById("mail-subject")?.focus({ preventScroll: true });
  }, [currentKey]);

  
  const landed = current && current.unread && !opened.has(keyOf(current)) ? current : null;
  useEffect(() => {
    if (!landed) return;
    const key = keyOf(landed);
    void post("/api/mail/opened", { account: landed.accountId, id: landed.id }).then(() => {
      setOpened((now) => new Set(now).add(key));
      countAgain(landed.accountId);
    });
  }, [landed, countAgain]);

  if (!mounted) return null;
  const noAccounts = mail !== null && mail.accounts.length === 0;
  const listed = (message: MailRow) => (
    <li key={keyOf(message)}>
      <MailRowView row={message} unread={isUnread(message)} current={current ? keyOf(current) === keyOf(message) : false} onOpen={() => open(message)} />
    </li>
  );
  const viewer = current && (
    <OpenMessage
      row={current}
      unread={isUnread(current)}
      tree={tree}
      tasks={tasks}
      replies={replies.data?.tasks ?? null}
      isDemo={Boolean(mail?.accounts.find((entry) => entry.id === current.accountId)?.isDemo)}
      onPrevious={index > 0 ? () => open(shown[index - 1]) : null}
      onNext={index >= 0 && index < shown.length - 1 ? () => open(shown[index + 1]) : null}
      onClose={narrow ? () => set({ message: null }) : undefined}
    />
  );

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page mail-page">
        <PageHeader
          title="Mail"
          count={
            noAccounts
              ? "No account connected"
              : !mail || holding
                ? `${PURPOSE} Reading the mail…`
                : `${PURPOSE} ${[unreadWords, `${shown.length} listed`, mail.waiting > 0 ? `${count(mail.waiting, "account", "accounts")} still reading` : null].filter(Boolean).join(", ").replace(/(\d) /g, "$1\u00a0")}.`
          }
          filters={
            mail && !noAccounts ? (
              <>
                <PlaceFilter value={place} tree={tree} counts={placeCounts} unit={MESSAGES} onChange={(value) => set({ place: value === ALL ? null : value, message: null })} noGeneral />
                <AccountFilter value={account} accounts={mail.accounts} counts={accountCounts} unit={MESSAGES} onChange={(value) => set({ account: value === ALL ? null : value, message: null })} />
              </>
            ) : undefined
          }
          filtersSet={(place === ALL ? 0 : 1) + (account === ALL ? 0 : 1)}
          chat
        />

        {readError && (
          <p role="alert" className="inline-note" data-tone="alert">
            The mail could not be read{mail ? " again" : ""}: {readError}.{mail ? " What shows is from the last read." : ""}
          </p>
        )}
        {replies.error && replies.error !== readError && (
          <p role="alert" className="inline-note" data-tone="alert">
            The possible replies of the tasks could not be read{replies.data ? " again" : ""}: {replies.error}.{replies.data ? " What shows is from the last read." : ""}
          </p>
        )}
        {failures.map((failure) => (
          <p key={failure.accountId} role={failure.partial ? "status" : "alert"} className="inline-note" data-tone={failure.partial ? undefined : "alert"} data-mail-failure>
            {mailFailureText(failure)}
          </p>
        ))}
        {apartHere?.error && (
          <p role="alert" className="inline-note" data-tone="alert" data-mail-not-opened>
            That message could not be opened: {apartHere.error}.
          </p>
        )}

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
            <section className="card mail-list" aria-label="Messages" aria-busy={!readWhole}>
              {!mail || holding || (mail.waiting > 0 && shown.length === 0) ? (
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
                        <span className="t-meta">{count(group.key === "forTasks" ? forTasks : group.messages.length, "message", "messages")}</span>
                      </h2>
                      {group.key === "forTasks" && waiting.map((entry) => <TaskRepliesGroup key={entry.task.id} entry={entry} listed={listed} />)}
                      {group.messages.length > 0 && <ul className="mail-rows">{group.messages.map(listed)}</ul>}
                    </div>
                  ))
              )}
            </section>
            {!narrow && (
              <div className="mail-view-column">
                <section className="card mail-view" aria-label="The open message">
                  <div className="mail-view-in">
                    {viewer ?? (
                      <div className="mail-view-none">
                        <h2 className="t-title">{shown.length > 0 || !revealed ? "Choose a message to read it here" : "A message opens here"}</h2>
                        <p className="t-help">It opens with its real design, beside what you can do with it: make it a task, link it, or say which task it answers. Gmail stays where you reply.</p>
                        <div className="mail-view-go">
                          {offered && (
                            <Button
                              onClick={() => {
                                focusSubject.current = true;
                                open(offered.row);
                              }}
                            >
                              {offered.label}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}
        {narrow && <MailSheet open={Boolean(current)} onClose={() => set({ message: null })}>{viewer}</MailSheet>}
      </div>
    </ViewTransition>
  );
}



function TaskRepliesGroup({ entry, listed }: { entry: TaskReplies; listed: (message: MailRow) => ReactNode }) {
  const title = inlinePlain(entry.task.title);
  const headId = `mail-task-${entry.task.id}`;
  return (
    <div className="mail-task" role="group" aria-labelledby={headId}>
      <div className="mail-task-head">
        <h3 id={headId} className="mail-task-title">
          <span className="t-meta">{`${repliesText(entry.replies.length, entry.more.length > 0)} for`}</span>
          <span className="t-value">{title}</span>
        </h3>
        <Button size="sm" variant="quiet" className="head-action" onClick={() => openTaskDetail({ id: entry.task.id })} aria-label={`Open the task “${title}”`}>
          Open the task
        </Button>
      </div>
      <ul className="mail-rows">{entry.replies.map(listed)}</ul>
    </div>
  );
}


function MailRowView({ row, unread, current, onOpen }: { row: MailRow; unread: boolean; current: boolean; onOpen: () => void }) {
  const line = taskLine(row);
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
        {line ? (
          <span className="mail-row-for" data-done={line.done ? "" : undefined}>
            {line.text}
          </span>
        ) : (
          row.place && <PlaceName path={row.place.path} color={row.place.color} />
        )}
        <span className="mail-row-account">{row.accountEmail}</span>
      </span>
    </button>
  );
}



function OpenMessage({
  row,
  unread,
  tree,
  tasks,
  replies,
  isDemo,
  onPrevious,
  onNext,
  onClose,
}: {
  row: MailRow;
  unread: boolean;
  tree: TreeNode[] | null;
  tasks: TaskData[];
  replies: TaskReplies[] | null;
  isDemo: boolean;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onClose?: () => void;
}) {
  const { notify, touch, saving } = useWorkspace();
  const phone = useMedia(MAIL_PHONE);
  const { mode, setMode } = useMailMode();
  const closeTask = useCompleteTask();
  
  const [answering, setAnswering] = useState<{ message: string; task: { id: string; title: string } } | null>(null);
  
  const [linking, setLinking] = useState<string | null>(null);
  const actions = useRef<HTMLDivElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const finder = useRef<HTMLDivElement>(null);
  
  const picked = useRef(false);
  const findingTask = useRef(false);
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
  
  const focusLink = () => actions.current?.closest("[data-mail-viewer]")?.querySelector<HTMLElement>(".mail-link-menu, .mail-more-menu")?.focus();
  
  function stopAnswering() {
    setAnswering(null);
    requestAnimationFrame(() => actions.current?.querySelector<HTMLElement>(".mail-answers-menu")?.focus());
  }

  const entries: MenuEntry[] = [
    {
      kind: "action",
      label: "A task…",
      disabled: candidates.length === 0,
      detail: candidates.length === 0 ? "No open task to link" : undefined,
      onSelect: () => {
        findingTask.current = true;
        setLinking(keyOf(row));
      },
    },
    {
      kind: "submenu",
      label: "A client or project",
      entries: nodes.length
        ? nodes.map((node): MenuEntry => ({ kind: "action", label: node.path, onSelect: () => void link({ node: node.id }, node.path) }))
        : [{ kind: "action", label: "Linked to every client and project", disabled: true, onSelect: () => undefined }],
    },
  ];
  
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
  
  const answersFirst = first.length > 0;
  
  const linkFocus = () => {
    const target = findingTask.current ? finder.current?.querySelector<HTMLElement>("input") : null;
    findingTask.current = false;
    return target;
  };
  
  const mayAnswer = first.filter((task) => !row.tasks.some((linked) => linked.id === task.id));
  const moreEntries: MenuEntry[] = [
    { kind: "submenu", label: "Link to…", entries },
    isDemo
      ? { kind: "action", label: "Open in Gmail", disabled: true, detail: "A sample account has no Gmail", onSelect: () => undefined }
      : { kind: "action", label: "Open in Gmail", onSelect: () => void window.open(gmail, "_blank", "noopener,noreferrer") },
    {
      kind: "choice",
      label: "Colors",
      value: mode,
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
      onChoose: (value) => setMode(value === "dark" ? "dark" : "light"),
    },
  ];

  const bar = (
    <div ref={actions} className="mail-action-row">
      <Button size="sm" variant={answersFirst ? "control" : "primary"} onClick={() => void createTask()}>
        <AddIcon />
        <span className="btn-label">Create task</span>
      </Button>
      <Menu
        label="Answers a task…"
        name={`Answers a task… “${row.subject}”`}
        entries={answers}
        variant={answersFirst ? "primary" : "control"}
        className="mail-answers-menu"
        finalFocus={() => {
          const target = picked.current ? outcome.current?.querySelector<HTMLElement>("button") : null;
          picked.current = false;
          return target;
        }}
      />
      {!phone && (
        <>
          <Menu label="Link to…" name={`Link to… “${row.subject}”`} entries={entries} variant="control" className="mail-link-menu" finalFocus={linkFocus} />
          {isDemo ? (
            <Button size="sm" disabled aria-describedby="mail-gmail-why">
              <ExternalIcon />
              <span className="btn-label">Open in Gmail</span>
            </Button>
          ) : (
            <a className={buttonClass({ size: "sm" })} href={gmail} target="_blank" rel="noopener noreferrer">
              <ExternalIcon />
              <span className="btn-label">Open in Gmail</span>
            </a>
          )}
        </>
      )}
    </div>
  );

  const below = (
    <>
      {isDemo && !phone && (
        <p id="mail-gmail-why" className="t-help mail-why">
          A sample account has no Gmail to open: its messages live only in this demo.
        </p>
      )}
      {linking === keyOf(row) && (
        <div ref={finder}>
          <TaskFinder
            key={keyOf(row)}
            tasks={candidates}
            onPick={(task) => {
              setLinking(null);
              void link({ task: task.id }, `“${inlinePlain(task.title)}”`);
              focusLink();
            }}
            onCancel={() => {
              setLinking(null);
              requestAnimationFrame(focusLink);
            }}
          />
        </div>
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
      {(mayAnswer.length > 0 || row.tasks.length > 0 || row.nodes.length > 0) && (
        <ul className="mail-linked" aria-label="What the message is linked to">
          {mayAnswer.map((task) => (
            <li key={`reply-${task.id}`} className="mail-linked-row">
              <button type="button" className="mail-linked-open" onClick={() => openTaskDetail({ id: task.id })}>
                <span className="t-meta">May answer the task</span>
                <span className="t-value">{inlinePlain(task.title)}</span>
              </button>
            </li>
          ))}
          {row.tasks.map((task) => (
            <li key={`task-${task.id}`} className="mail-linked-row">
              <button type="button" className="mail-linked-open" onClick={() => openTaskDetail({ id: task.id })}>
                <span className="t-meta">{task.status === "done" ? "Linked to the task, done" : "Linked to the task"}</span>
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

  const more = phone ? <Menu label="More" about={`for “${row.subject}”`} entries={moreEntries} variant="control" className="mail-more-menu" finalFocus={linkFocus} /> : null;

  return <MailViewer row={{ ...row, unread }} onPrevious={onPrevious} onNext={onNext} onClose={onClose} actions={bar} below={below} more={more} />;
}


const FOUND_SHOWN = 12;


function TaskFinder({ tasks, onPick, onCancel }: { tasks: TaskData[]; onPick: (task: TaskData) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const found = useMemo(() => tasksMatching(tasks, query), [tasks, query]);
  const shown = found.slice(0, FOUND_SHOWN);
  const rest = found.length - shown.length;
  return (
    <div className="stack" role="group" aria-label="Link the message to a task" data-task-finder>
      <Field
        autoFocus
        aria-label="Find the task by its title or its place"
        placeholder="Find the task by its title or its place"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      {shown.length > 0 ? (
        <ul className="mail-linked" aria-label="Open tasks that match">
          {shown.map((task) => (
            <li key={task.id} className="mail-linked-row">
              <button type="button" className="mail-linked-open" onClick={() => onPick(task)}>
                <span className="t-meta">{task.path ?? "General"}</span>
                <span className="t-value">{inlinePlain(task.title)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-help">No open task matches “{query.trim()}”.</p>
      )}
      <p className="t-meta" role="status">
        {rest > 0 ? `${count(found.length, "open task matches", "open tasks match")}: type more of its title to reach the other ${rest}.` : count(found.length, "open task matches", "open tasks match")}
      </p>
      <Button size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}


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
