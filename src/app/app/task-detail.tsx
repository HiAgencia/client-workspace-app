"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { RichEditor } from "@/components/ui/rich-editor";
import { Select, type SelectOption } from "@/components/ui/select";
import { addDays, instantsOf, LOCALE, today } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { richTextToPlain } from "@/lib/rich-text";
import { get, post, tool, type Answer, type Item } from "./client-api";
import { PRIORITIES, sourceName } from "./item-parts";
import { subjectOf } from "./mail/subject";
import { TaskOutcome, useCompleteTask } from "./task-outcome";
import { accountsSeenFrom } from "./task-replies";
import {
  dayName,
  InlineText,
  onOpenTaskDetail,
  openTaskDetail,
  pasteLinkOver,
  PlaceName,
  readTaskItem,
  TaskCircle,
  taskFromItem,
  timeLabel,
  useTaskActions,
  whenLabel,
  type TaskData,
  type TaskDetailRequest,
} from "./task-row";
import { useWorkspace } from "./workspace";
import "../styles/mail.css";

type Note = { id: string; title: string; body: string | null; decision: boolean; createdAt: string };
type Revision = { id: string; createdAt: string; source: Item["source"]; agentLabel: string | null; snapshot: { title: string; deleted_at: string | null } };
type EventLink = { link: { eventId: string | null; googleEventId: string | null } | null; event: { title: string; allDay: boolean; startsOn: string | null; startsAt: string | null } | null };
type BrowsedEvent = { id: string; title: string; start: string; allDay: boolean; origin: "google" | "local"; localId: string | null; accountId: string; calendarId: string };

const SAVE: Record<"saving" | "saved" | "failed", string> = { saving: "Saving…", saved: "Saved", failed: "Not saved" };

// The hours a task can take, every half hour of the day.
const NO_TIME = "none";
const TIMES: SelectOption[] = [
  { value: NO_TIME, label: "No time" },
  ...Array.from({ length: 48 }, (_, i) => {
    const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
    return { value, label: timeLabel(value) };
  }),
];

const stamp = (iso: string) => new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" }).format(new Date(iso));
const stampTime = (iso: string) => new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const addedBy = (source: Item["source"], label: string | null) =>
  source === "manual" ? "Added by hand" : source === "chat" ? "Added by the chat" : `Added by an agent${label ? ` · ${label}` : ""}`;

function eventWhen(event: { allDay: boolean; startsOn?: string | null; startsAt?: string | null; start?: string }): string {
  const day = event.allDay ? (event.startsOn ?? event.start?.slice(0, 10)) : null;
  if (day) return dayName(day);
  const at = event.startsAt ?? event.start;
  if (!at) return "";
  const date = new Date(at);
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${dayName(local)}, ${new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

// A task's detail, a dialog at the center like Todoist's. On the left what is written —the title, the description,
// the subtasks and the notes—; on the right its attributes, each a field that changes where it is; on top, where it
// lives, «Previous» and «Next» through the list it came from, «More» and «Close». Mounted once; any row opens it.
export function TaskDetail() {
  const { tree, saving, version } = useWorkspace();
  const actions = useTaskActions();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const eventTrigger = useRef<HTMLDivElement>(null);
  const popupOpen = useRef(false);
  const [request, setRequest] = useState<TaskDetailRequest | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"" | "saving" | "saved" | "failed">("");
  const titleId = useId();
  const descId = useId();

  // What is typed in the description saves when typing stops, one save at a time, in order.
  const latest = useRef("");
  const confirmed = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const current = useRef<string | null>(null);

  const flush = useCallback((): Promise<unknown> => {
    clearTimeout(timer.current);
    const value = latest.current.trim();
    const id = current.current;
    if (!id || value === confirmed.current) return queue.current;
    setStatus("saving");
    queue.current = queue.current.then(async () => {
      const ok = await saving(tool("update_item", { id, notes: value || null }));
      if (current.current !== id) return;
      if (!ok) return setStatus("failed");
      confirmed.current = value;
      setStatus(latest.current.trim() === value ? "saved" : "saving");
    });
    return queue.current;
  }, [saving]);

  const load = useCallback(async (next: TaskDetailRequest) => {
    current.current = next.id;
    setFailed(null);
    const found = await readTaskItem(next.id);
    if (current.current !== next.id) return;
    if (!found) return setFailed("This task is not here any more: it was deleted.");
    setItem(found);
    latest.current = found.body ?? "";
    confirmed.current = found.body ?? "";
    setBody(found.body ?? "");
    setStatus("");
  }, []);

  // A row asks: the dialog opens on that task, painted from what the row knew while the rest is read.
  useEffect(
    () =>
      onOpenTaskDetail((next) => {
        const el = dialog.current;
        if (!el) return;
        if (!el.open) opener.current = document.activeElement as HTMLElement | null;
        setRequest(next);
        const known = next.task;
        setItem(
          known?.title
            ? {
                id: next.id,
                nodeId: known.nodeId ?? null,
                nodePath: known.path ?? null,
                parentId: known.parentId ?? null,
                type: "task",
                title: known.title,
                body: null,
                status: known.status ?? "open",
                priority: known.priority ?? 4,
                dueOn: known.dueOn ?? null,
                dueTime: known.dueTime ?? null,
                source: known.source ?? "manual",
                agentLabel: known.agentLabel ?? null,
                createdAt: known.createdAt ?? new Date().toISOString(),
              }
            : null,
        );
        void load(next);
        if (!el.open) el.showModal();
        requestAnimationFrame(() => {
          const target = next.focus === "event" ? eventTrigger.current?.querySelector<HTMLElement>("button") : heading.current;
          target?.focus({ preventScroll: true });
        });
      }),
    [load],
  );

  // Something changed elsewhere (a subtask, the chat): the task is read again, keeping what is being typed.
  useEffect(() => {
    const id = current.current;
    if (!id || !dialog.current?.open || !item) return;
    void readTaskItem(id).then((found) => {
      if (found && current.current === id) setItem((was) => (was ? { ...found, body: was.body } : found));
    });
    // Only a new version reads again; the item itself does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  function close() {
    void flush().then(() => dialog.current?.close());
  }

  function onClosed() {
    void flush();
    const id = current.current;
    current.current = null;
    setRequest(null);
    setItem(null);
    // The focus goes back to the row it came from, or to what opened the dialog.
    requestAnimationFrame(() => {
      const row = id ? document.querySelector<HTMLElement>(`[data-item="${id}"] .task-open`) : null;
      (row ?? opener.current)?.focus({ preventScroll: true });
    });
  }

  const list = request?.list ?? [];
  const index = item ? list.findIndex((entry) => entry.id === item.id) : -1;
  function step(by: number) {
    const next = list[index + by];
    if (!next) return;
    void flush().then(() => {
      setRequest({ id: next.id, task: next, list });
      setItem(null);
      void load({ id: next.id, task: next, list });
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    });
  }

  async function change(input: Record<string, unknown>) {
    if (!item) return;
    const id = item.id;
    const answer = await tool<{ item: Item }>("update_item", { id, ...input });
    if ((await saving(Promise.resolve(answer))) && answer.ok && current.current === id) setItem({ ...answer.item, body: latest.current || null });
  }

  async function movePlace(value: string) {
    if (!item) return;
    const node = value === "general" ? null : value;
    if (node === item.nodeId) return;
    const answer = await tool<{ item: Item }>("move_item", { id: item.id, node });
    if ((await saving(Promise.resolve(answer))) && answer.ok) setItem({ ...answer.item, body: latest.current || null });
  }

  const [showVersions, setShowVersions] = useState(false);
  const task = item ? taskFromItem(item) : null;
  const more: MenuEntry[] = task
    ? [
        { kind: "action", label: "Duplicate", onSelect: () => void actions.duplicate(task) },
        {
          kind: "action",
          label: "Versions",
          onSelect: () => {
            setShowVersions(true);
            requestAnimationFrame(() => document.getElementById(`${titleId}-versions`)?.focus({ preventScroll: false }));
          },
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Delete",
          tone: "danger",
          onSelect: () => {
            void flush().then(() => {
              dialog.current?.close();
              void actions.remove(task);
            });
          },
        },
      ]
    : [];

  const places: SelectOption[] = [{ value: "general", label: "General" }, ...(tree ?? []).map((node) => ({ value: node.id, label: node.path }))];
  const isSubtask = Boolean(item?.parentId);

  return (
    <dialog
      ref={dialog}
      className="dialog task-detail"
      aria-labelledby={titleId}
      onKeyDownCapture={(event) => {
        // A list or a menu open inside takes this Escape: read before its own handler closes it.
        if (event.key === "Escape") popupOpen.current = Boolean(dialog.current?.querySelector("[data-popup-open]"));
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (popupOpen.current) {
          popupOpen.current = false;
          return;
        }
        close();
      }}
      onClose={onClosed}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.dataset.downOutside = "";
      }}
      onClick={(event) => {
        if (event.target === dialog.current && dialog.current.dataset.downOutside !== undefined) close();
        if (dialog.current) delete dialog.current.dataset.downOutside;
      }}
    >
      <PopupLayerProvider container={dialog}>
        {item ? (
          <div className="task-detail-in">
            <header className="task-detail-head">
              <p className="task-detail-path t-meta">
                {item.nodeId ? (
                  <Link className="link link-meta" href={`/app/node/${item.nodeId}`} onClick={() => dialog.current?.close()}>
                    <PlaceName path={item.nodePath} color={null} />
                  </Link>
                ) : (
                  <PlaceName path={null} color={null} />
                )}
                {isSubtask && <span className="task-detail-kind"> · Subtask</span>}
              </p>
              <div className="task-detail-bar">
                <Button size="sm" variant="quiet" disabled={index <= 0} onClick={() => step(-1)} aria-label={index <= 0 ? "Previous: this is the first task of the list" : undefined}>
                  Previous
                </Button>
                <Button size="sm" variant="quiet" disabled={index < 0 || index >= list.length - 1} onClick={() => step(1)} aria-label={index < 0 || index >= list.length - 1 ? "Next: this is the last task of the list" : undefined}>
                  Next
                </Button>
                <Menu label="More" about={`for “${inlinePlain(item.title)}”`} entries={more} />
                <Button size="sm" onClick={close}>
                  Close
                </Button>
              </div>
            </header>
            <div className="task-detail-body">
              <div className="task-detail-main">
                <div className="task-detail-title-row">
                  <TaskCircle
                    className="task-check"
                    title={item.title}
                    priority={item.priority}
                    done={item.status === "done"}
                    onToggle={() => {
                      if (!task) return;
                      // It shows at once; when the server refuses, the detail puts back what it had (the notice says why).
                      const was = item.status;
                      const id = item.id;
                      setItem({ ...item, status: was === "done" ? "open" : "done" });
                      void actions.complete(task).then((ok) => {
                        if (!ok && current.current === id) setItem((now) => (now && now.id === id ? { ...now, status: was } : now));
                      });
                    }}
                  />
                  <TitleField key={item.id} id={titleId} title={item.title} headingRef={heading} onSave={(title) => change({ title })} />
                </div>
                <div className="task-detail-desc">
                  <label className="sr-only" htmlFor={descId}>
                    Description
                  </label>
                  <RichEditor
                    key={item.id}
                    id={descId}
                    label="Description"
                    value={body}
                    placeholder="Description"
                    onChange={(value) => {
                      setBody(value);
                      latest.current = value;
                      setStatus("");
                      clearTimeout(timer.current);
                      timer.current = setTimeout(() => void flush(), 700);
                    }}
                    onBlur={() => void flush()}
                    onEscape={close}
                  />
                  {/* The line keeps its room while empty; the meta words exist only while there is something to say. */}
                  <p className="task-detail-status" role="status" data-shown={status || undefined}>
                    {status && <span className="t-meta">{SAVE[status]}</span>}
                  </p>
                </div>
                {!isSubtask && <SubtaskSection key={`s-${item.id}`} task={item} version={version} />}
                <NoteSection key={`n-${item.id}`} task={item} version={version} />
                {showVersions && <Versions key={`v-${item.id}`} id={`${titleId}-versions`} task={item} onRestored={() => void load({ id: item.id, task: { id: item.id, nodeId: item.nodeId } })} />}
              </div>
              <aside className="task-detail-side" aria-label="Attributes">
                <dl className="task-attrs">
                  <div className="task-attr">
                    <dt className="t-label">Place</dt>
                    <dd>
                      <Select label="Place" value={item.nodeId ?? "general"} options={places} onChange={(value) => void movePlace(value)} />
                    </dd>
                  </div>
                  <div className="task-attr">
                    <dt className="t-label">Date</dt>
                    <dd className="task-attr-date">
                      <DatePicker
                        label="Date"
                        value={item.dueOn}
                        display={whenLabel(item.dueOn, null)}
                        onChange={(dueOn) => void change({ dueOn })}
                      />
                      {item.dueOn ? (
                        <Select label="Time" value={item.dueTime ?? NO_TIME} options={TIMES} onChange={(value) => void change({ dueTime: value === NO_TIME ? null : value })} />
                      ) : (
                        <p className="t-meta">A time goes with a day.</p>
                      )}
                    </dd>
                  </div>
                  <div className="task-attr">
                    <dt className="t-label">Priority</dt>
                    <dd>
                      <Select label="Priority" value={String(item.priority ?? 4)} options={PRIORITIES} onChange={(value) => void change({ priority: Number(value) })} />
                    </dd>
                  </div>
                  <div className="task-attr">
                    <dt className="t-label">Event</dt>
                    <dd ref={eventTrigger}>
                      <EventField key={item.id} task={item} />
                    </dd>
                  </div>
                  {/* The mail a task waits for goes here, once the mail's own layer gives it: the account it waits in and
                      the mail linked to it. */}
                  <MailAttribute task={item} />
                </dl>
                <p className="t-meta task-detail-origin">
                  {addedBy(item.source, item.agentLabel)}, {stamp(item.createdAt)}
                </p>
              </aside>
            </div>
          </div>
        ) : (
          <div className="task-detail-in" aria-busy={!failed} role="status" aria-label={failed ? undefined : "Reading the task"}>
            {failed ? (
              <div className="task-detail-missing">
                <p className="inline-note" data-tone="alert">
                  {failed}
                </p>
                <Button size="sm" onClick={() => dialog.current?.close()}>
                  Close
                </Button>
              </div>
            ) : (
              <>
                <span className="skeleton skeleton-title" />
                <span className="skeleton" />
                <span className="skeleton" />
              </>
            )}
          </div>
        )}
      </PopupLayerProvider>
    </dialog>
  );
}

// ---- Mail: what a task waits for, its possible replies, and the messages linked to it ------------------------------
// The person says what the task waits for in their own words; the app shows what arrived with those words in the sender
// or the subject as possible replies, and the person decides which one answers the task and how it ended. Nothing closes
// the task on its own.

type TaskWait = { accountId: string | null; waitsFor: string; since: string; dismissed: string[] };
type MailMessageRow = { id: string; accountId: string; accountEmail: string; from: { name: string | null; email: string }; subject: string; receivedAt: string };
type MailFailure = { accountEmail: string; reason: string };
type MailDetail = { mail: TaskWait | null; messages: MailMessageRow[]; mailFailures: MailFailure[] };
type MailAccount = { id: string; email: string; nodeIds: string[] };
// What was read of the possible replies, and where each account's next ones start.
type RepliesRead = { replies: MailMessageRow[]; next: Record<string, string>; failures: MailFailure[] };

const WAIT_NONE = "none";
const WAIT_PLACE = "place";
// How many possible replies each account brings at a time; «Show more replies» brings the next ones, as many times as
// there are.
const REPLIES = 20;

const replyKey = (reply: { accountId: string; id: string }) => `${reply.accountId}:${reply.id}`;
const newestFirst = (a: MailMessageRow, b: MailMessageRow) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0);

// The reads of some accounts joined: their replies newest first, each once, where each one's next replies start, and
// the accounts that could not be read.
function joinReads(answers: Array<Answer<RepliesRead>>, accounts: Array<{ id: string; email: string }>, before: MailMessageRow[] = []): RepliesRead {
  const failures: MailFailure[] = [];
  const next: Record<string, string> = {};
  const seen = new Set(before.map(replyKey));
  const rows = [...before];
  answers.forEach((answer, index) => {
    if (!answer.ok) return void failures.push({ accountEmail: accounts[index].email, reason: answer.message });
    for (const reply of answer.replies) {
      if (seen.has(replyKey(reply))) continue;
      seen.add(replyKey(reply));
      rows.push(reply);
    }
    Object.assign(next, answer.next);
    failures.push(...answer.failures);
  });
  return { replies: rows.sort(newestFirst), next, failures };
}

function MailAttribute({ task }: { task: Item }) {
  const { tree, notify, touch, version } = useWorkspace();
  const [detail, setDetail] = useState<{ id: string; read: MailDetail | null; error: string | null } | null>(null);
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
  // Where the person chose to wait before saying what for: a wait needs its words before it is saved.
  const [pending, setPending] = useState<{ id: string; account: string | null } | null>(null);
  const [words, setWords] = useState<{ id: string; value: string } | null>(null);
  const [replies, setReplies] = useState<{ key: string; read: RepliesRead | null } | null>(null);
  const [readingMore, setReadingMore] = useState(false);
  // The reply whose result is being chosen.
  const [choosing, setChoosing] = useState<string | null>(null);
  const closeTask = useCompleteTask();
  const wordsId = useId();
  const wordsHelpId = useId();
  const repliesId = useId();

  useEffect(() => {
    let live = true;
    void Promise.all([tool<MailDetail>("get_item", { id: task.id }), get<{ accounts: MailAccount[] }>("/api/accounts")]).then(([answer, listed]) => {
      if (!live) return;
      setDetail({ id: task.id, read: answer.ok ? { mail: answer.mail, messages: answer.messages, mailFailures: answer.mailFailures } : null, error: answer.ok ? null : answer.message });
      if (listed.ok) setAccounts(listed.accounts);
    });
    return () => {
      live = false;
    };
  }, [task.id, version]);

  const read = detail?.id === task.id ? detail.read : null;
  const mail = read?.mail ?? null;
  const waitingHere = pending?.id === task.id ? pending : null;
  // The accounts its place sees: those hanging from the place or above it; a general task reads every account.
  const seen = new Set(accountsSeenFrom(tree, accounts ?? [], task.nodeId));
  const visible = (accounts ?? []).filter((account) => seen.has(account.id));
  const placeLabel = task.nodeId === null ? "Every account" : "Every account of its place";
  const options: SelectOption[] = [
    { value: WAIT_NONE, label: "No mail" },
    ...(visible.length > 0 ? [{ value: WAIT_PLACE, label: placeLabel }] : []),
    ...visible.map((account) => ({ value: account.id, label: account.email })),
  ];
  const value = waitingHere ? (waitingHere.account ?? WAIT_PLACE) : !mail ? WAIT_NONE : (mail.accountId ?? WAIT_PLACE);
  const wordsValue = words?.id === task.id ? words.value : (mail?.waitsFor ?? "");
  // The accounts the wait looks in, each read on its own and all at once.
  const lookIn = mail ? visible.filter((account) => mail.accountId === null || account.id === mail.accountId) : [];
  const repliesKey = mail && task.status === "open" ? `${task.id}:${mail.accountId ?? ""}:${mail.waitsFor}:${lookIn.map((account) => account.id).join(",")}:${version}` : null;

  useEffect(() => {
    if (!repliesKey) return;
    let live = true;
    void Promise.all(lookIn.map((account) => tool<RepliesRead>("list_task_replies", { task: task.id, account: account.id, limit: REPLIES }))).then((answers) => {
      if (live) setReplies({ key: repliesKey, read: joinReads(answers, lookIn) });
    });
    return () => {
      live = false;
    };
    // The key carries everything the reads depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repliesKey]);
  const shown = replies?.key === repliesKey ? replies.read : null;

  // The next replies of each account that holds more, all at once, added to what is shown.
  async function readMore() {
    if (!shown || !repliesKey) return;
    const pages = Object.entries(shown.next);
    setReadingMore(true);
    const answers = await Promise.all(pages.map(([account, pageToken]) => tool<RepliesRead>("list_task_replies", { task: task.id, account, limit: REPLIES, pageToken })));
    setReadingMore(false);
    const emails = pages.map(([account]) => ({ id: account, email: lookIn.find((entry) => entry.id === account)?.email ?? "An account" }));
    setReplies((current) => (current?.key === repliesKey && current.read ? { key: repliesKey, read: joinReads(answers, emails, current.read.replies) } : current));
  }

  async function save(input: Record<string, unknown>, text: string) {
    const answer = await tool<{ mail: TaskWait | null; previous: TaskWait | null }>("set_task_mail", { task: task.id, ...input });
    if (!answer.ok) return notify({ text: `What “${inlinePlain(task.title)}” waits for could not be saved: ${answer.message}`, tone: "error" });
    setDetail((current) => (current && current.read ? { ...current, read: { ...current.read, mail: answer.mail } } : current));
    setPending(null);
    setWords(null);
    touch();
    const previous = answer.previous;
    notify({
      text,
      tone: "status",
      undo: () =>
        void tool("set_task_mail", previous ? { task: task.id, account: previous.accountId, words: previous.waitsFor } : { task: task.id, waiting: false }).then(() => touch()),
    });
  }

  function choose(next: string) {
    if (next === value) return;
    if (next === WAIT_NONE) {
      if (waitingHere) return setPending(null);
      return void save({ waiting: false }, `“${inlinePlain(task.title)}” waits for no mail now`);
    }
    const account = next === WAIT_PLACE ? null : next;
    // Before it waits, the account is kept until the person says what for; once it waits, the account changes at once.
    if (!mail) return setPending({ id: task.id, account });
    const where = account ? (visible.find((entry) => entry.id === account)?.email ?? "that account") : placeLabel.toLowerCase();
    void save({ account }, `“${inlinePlain(task.title)}” waits for its mail in ${where}`);
  }

  function saveWords() {
    const next = wordsValue.trim();
    if (waitingHere) {
      if (!next) return notify({ text: "Say what it waits for: who sends it or what it is about.", tone: "error" });
      return void save({ account: waitingHere.account, words: next }, `“${inlinePlain(task.title)}” waits for mail with “${next}”`);
    }
    if (!mail) return;
    // A wait keeps its words: an empty field goes back to them.
    if (!next) return setWords(null);
    if (next === mail.waitsFor) return;
    void save({ words: next }, `“${inlinePlain(task.title)}” waits for mail with “${next}”`);
  }

  async function complete(reply: MailMessageRow, outcome: string) {
    if (await closeTask(task, reply, outcome)) setChoosing(null);
  }

  // Leaving the choice puts the focus back on the «This is it» that opened it.
  function stopChoosing(trigger: string) {
    setChoosing(null);
    requestAnimationFrame(() => document.getElementById(trigger)?.focus());
  }

  async function dismiss(reply: MailMessageRow) {
    const answer = await tool("dismiss_reply", { task: task.id, account: reply.accountId, id: reply.id, dismissed: true });
    if (!answer.ok) return notify({ text: `“${subjectOf(reply)}” could not be ruled out: ${answer.message}`, tone: "error" });
    setReplies((current) => (current?.read ? { ...current, read: { ...current.read, replies: current.read.replies.filter((entry) => replyKey(entry) !== replyKey(reply)) } } : current));
    notify({
      text: `“${subjectOf(reply)}” is not what “${inlinePlain(task.title)}” waits for`,
      tone: "status",
      undo: () => void tool("dismiss_reply", { task: task.id, account: reply.accountId, id: reply.id, dismissed: false }).then(() => touch()),
    });
  }

  const asking = Boolean(mail) || Boolean(waitingHere);
  return (
    <div className="task-attr task-mail-attr" data-task-mail={mail ? "waiting" : "none"}>
      <dt className="t-label">Mail</dt>
      <dd className="task-mail-body">
        {!read && !detail?.error ? (
          <span className="skeleton" aria-label="Reading the mail it waits for" />
        ) : detail?.error ? (
          <p className="inline-note" data-tone="alert">
            Its mail could not be read: {detail.error}
          </p>
        ) : (
          <>
            {options.length > 1 ? (
              <Select label="Waits for mail in" value={value} options={options} onChange={choose} />
            ) : (
              <p className="t-help">No account is connected where this task lives, so it waits for no mail.</p>
            )}
            {asking && (
              <div className="task-mail-words">
                <label className="t-label" htmlFor={wordsId}>
                  What it waits for
                </label>
                <input
                  id={wordsId}
                  className="field"
                  value={wordsValue}
                  placeholder="Meta, app review"
                  maxLength={200}
                  autoFocus={Boolean(waitingHere)}
                  aria-describedby={wordsHelpId}
                  onChange={(event) => setWords({ id: task.id, value: event.target.value })}
                  onBlur={() => {
                    if (mail) saveWords();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveWords();
                    }
                    if (event.key === "Escape" && wordsValue !== (mail?.waitsFor ?? "")) {
                      event.preventDefault();
                      event.stopPropagation();
                      setWords(null);
                    }
                  }}
                />
                <p id={wordsHelpId} className="t-help">
                  Who sends it or what it is about. Every word is looked for in the sender and the subject of what arrives.
                </p>
                {waitingHere && (
                  <Button size="sm" variant="primary" onClick={saveWords} disabled={!wordsValue.trim()}>
                    Start waiting
                  </Button>
                )}
              </div>
            )}
            {mail && task.status === "open" && (
              <section className="task-replies" aria-labelledby={repliesId}>
                <p className="t-label" id={repliesId}>
                  Possible replies
                </p>
                <p className="t-help">
                  What arrived since {stamp(mail.since)} with these words. You decide which one answers it.
                </p>
                {!shown ? (
                  <span className="skeleton" aria-label="Reading its possible replies" />
                ) : shown.replies.length === 0 ? (
                  <p className="t-help">Nothing has arrived with these words yet.</p>
                ) : (
                  <ul className="task-reply-list">
                    {shown.replies.map((reply, index) => {
                      const key = replyKey(reply);
                      const trigger = `${repliesId}-${index}`;
                      return (
                        <li key={key} className="task-reply" data-reply-open={choosing === key ? "" : undefined}>
                          <Link className="task-mail-link" href={`/app/mail?message=${encodeURIComponent(key)}`}>
                            <span className="t-value">{subjectOf(reply)}</span>
                            <span className="t-meta">
                              {reply.from.name ?? reply.from.email}, {stamp(reply.receivedAt)}
                            </span>
                          </Link>
                          <div className="task-reply-actions">
                            <Button id={trigger} size="sm" aria-expanded={choosing === key} onClick={() => (choosing === key ? stopChoosing(trigger) : setChoosing(key))}>
                              This is it
                            </Button>
                            <Button size="sm" variant="quiet" onClick={() => void dismiss(reply)}>
                              Not it
                            </Button>
                          </div>
                          {choosing === key && (
                            <TaskOutcome question="How did it end?" title={task.title} onClose={(outcome) => void complete(reply, outcome)} onCancel={() => stopChoosing(trigger)} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {shown && Object.keys(shown.next).length > 0 && (
                  <Button size="sm" variant="quiet" onClick={() => void readMore()} disabled={readingMore} aria-busy={readingMore || undefined}>
                    {readingMore ? "Reading more replies…" : "Show more replies"}
                  </Button>
                )}
                {shown?.failures.map((failure) => (
                  <p key={failure.accountEmail} className="inline-note" data-tone="alert">
                    The mail of {failure.accountEmail} could not be read: {failure.reason}
                  </p>
                ))}
              </section>
            )}
            {mail && (
              <Button size="sm" variant="quiet" onClick={() => choose(WAIT_NONE)}>
                Stop waiting
              </Button>
            )}
            {read && read.messages.length > 0 && (
              <ul className="task-mail-list" aria-label="Its mail">
                {read.messages.map((message) => (
                  <li key={replyKey(message)}>
                    <Link className="task-mail-link" href={`/app/mail?message=${encodeURIComponent(replyKey(message))}`}>
                      <span className="t-value">{subjectOf(message)}</span>
                      <span className="t-meta">
                        {message.from.name ?? message.from.email}, {stamp(message.receivedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {read?.mailFailures.map((failure) => (
              <p key={failure.accountEmail} className="inline-note" data-tone="alert">
                The mail of {failure.accountEmail} could not be read: {failure.reason}
              </p>
            ))}
          </>
        )}
      </dd>
    </div>
  );
}

// The title reads as written, its links over its words; a click on it (not on a link) or Enter edits it in place.
function TitleField({ id, title, headingRef, onSave }: { id: string; title: string; headingRef: RefObject<HTMLDivElement | null>; onSave: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const field = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  function start() {
    done.current = false;
    setValue(title);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = value.replace(/\s+/g, " ").trim();
    if (save && next && next !== title) void onSave(next);
    requestAnimationFrame(() => headingRef.current?.querySelector<HTMLElement>(".task-detail-title-edit")?.focus({ preventScroll: true }));
  }

  if (editing) {
    return (
      <textarea
        ref={field}
        className="field task-detail-title-field"
        aria-label="Title"
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onPaste={(event) => {
          const next = pasteLinkOver(event.currentTarget, event.clipboardData.getData("text"));
          if (next !== null) {
            event.preventDefault();
            setValue(next);
          }
        }}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    );
  }
  return (
    <div ref={headingRef} className="task-detail-title" tabIndex={-1}>
      <h2 id={id} className="t-title task-detail-title-text">
        <InlineText text={title} />
      </h2>
      <button type="button" className="task-detail-title-edit" aria-label={`Edit the title “${inlinePlain(title)}”`} onClick={start} />
    </div>
  );
}

// One line that adds: a subtask or a note. A link pasted over selected words stays on them.
function AddLine({ label, field, onAdd, onDone }: { label: string; field: string; onAdd: (text: string) => Promise<boolean>; onDone: () => void }) {
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
    <div className="task-add-line">
      <input
        autoFocus
        className="field"
        aria-label={field}
        placeholder={field}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onPaste={(event) => {
          const next = pasteLinkOver(event.currentTarget, event.clipboardData.getData("text"));
          if (next !== null) {
            event.preventDefault();
            setValue(next);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone();
          }
        }}
      />
      <Button size="sm" onClick={onDone}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" onClick={() => void add()} aria-busy={busy} disabled={busy || !value.trim()}>
        {label}
      </Button>
    </div>
  );
}

function SubtaskSection({ task, version }: { task: Item; version: number }) {
  const { saving } = useWorkspace();
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    void tool<{ items: Item[] }>("list_items", { parent: task.id, type: "task", status: "all" }).then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setItems(answer.items);
        setFailed(null);
      } else setFailed(answer.message);
    });
    return () => {
      live = false;
    };
  }, [task.id, version]);
  const done = items?.filter((item) => item.status === "done").length ?? 0;
  const list = (items ?? []).map((item) => ({ id: item.id, title: item.title, nodeId: item.nodeId, parentId: item.parentId }));
  return (
    <section className="task-section" aria-labelledby={`sub-${task.id}`}>
      <h3 id={`sub-${task.id}`} className="t-label task-section-head">
        Subtasks {items && items.length > 0 && <span className="t-meta">{`${done}/${items.length}`}</span>}
      </h3>
      {items === null && failed ? (
        <p className="inline-note" data-tone="alert">
          The subtasks could not be read: {failed}
        </p>
      ) : items === null ? (
        <span className="skeleton" role="status" aria-label="Reading the subtasks" />
      ) : (
        items.length > 0 && (
          <ul className="task-subtask-list">
            {items.map((item) => (
              <li key={item.id} className="task-subtask" data-done={item.status === "done" || undefined}>
                <TaskCircle title={item.title} priority={item.priority} done={item.status === "done"} onToggle={() => void saving(tool("update_item", { id: item.id, status: item.status === "done" ? "open" : "done" }))} />
                <button
                  type="button"
                  className="task-subtask-title t-value"
                  onClick={() => openTaskDetail({ id: item.id, task: { id: item.id, title: item.title, nodeId: item.nodeId, parentId: item.parentId }, list })}
                >
                  {inlinePlain(item.title)}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {adding ? (
        <AddLine
          label="Add subtask"
          field="Subtask"
          onAdd={(title) => saving(tool("create_task", { parent: task.id, title }))}
          onDone={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
          }}
        />
      ) : (
        <button ref={addButton} type="button" className="task-add" onClick={() => setAdding(true)}>
          Add subtask
        </button>
      )}
    </section>
  );
}

// One note of a task: its words, with the links over them and its «Decision» mark; a click on it (not on a link) edits it
// in place —Enter saves, Shift+Enter starts a line, Escape cancels—, and its «More» marks it as a decision or deletes it.
function NoteRow({ note, onSave, onDecision, onDelete }: { note: Note; onSave: (text: string) => Promise<boolean>; onDecision: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  // What is edited is the note's words as plain text; a link over words is written `[words](address)`.
  const text = note.body ? richTextToPlain(note.body).trim() || note.title : note.title;

  function start() {
    done.current = false;
    setValue(text);
    setEditing(true);
    // From the menu, the menu first gives the focus back to its button; the field takes it after.
    setTimeout(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 60);
  }

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    setEditing(false);
    if (save && next && next !== text) void onSave(next);
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  }

  const plain = inlinePlain(note.title);
  return (
    <li className="task-note t-body" data-note={note.id} data-decision={note.decision || undefined}>
      {editing ? (
        <textarea
          ref={field}
          className="field task-note-field"
          aria-label="Note"
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPaste={(event) => {
            const next = pasteLinkOver(event.currentTarget, event.clipboardData.getData("text"));
            if (next !== null) {
              event.preventDefault();
              setValue(next);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              finish(true);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
        />
      ) : (
        <div className="task-note-body">
          <span className="task-note-text">
            <InlineText text={note.title} />
          </span>
          <button ref={editButton} type="button" className="task-note-edit" aria-label={`Edit the note “${plain}”`} onClick={start} />
        </div>
      )}
      {note.decision && (
        <span className="pill" data-tone="accent">
          Decision
        </span>
      )}
      <div className="task-note-more">
        <Menu
          label="More"
          about={`for the note “${plain}”`}
          entries={[
            { kind: "action", label: "Edit", onSelect: start },
            { kind: "action", label: note.decision ? "Make it a note again" : "Mark as a decision", onSelect: onDecision },
            { kind: "separator" },
            { kind: "action", label: "Delete", tone: "danger", onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  );
}

function NoteSection({ task, version }: { task: Item; version: number }) {
  const { saving, notify, touch } = useWorkspace();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // A change to a note shows at once and goes back, saying so, if the server refuses it.
  const [patched, setPatched] = useState<Record<string, Partial<Note>>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    void tool<{ notes: Note[] }>("list_notes", { parent: task.id }).then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setNotes(answer.notes);
        setPatched({});
        setFailed(null);
      } else setFailed(answer.message);
    });
    return () => {
      live = false;
    };
  }, [task.id, version]);

  const patch = (id: string, change: Partial<Note> | null) =>
    setPatched((was) => {
      const next = { ...was };
      if (change) next[id] = { ...next[id], ...change };
      else delete next[id];
      return next;
    });
  const hide = (id: string, on: boolean) =>
    setHidden((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function saveNote(note: Note, text: string): Promise<boolean> {
    const before = inlinePlain(note.title);
    patch(note.id, { title: text.split("\n")[0] });
    const answer = await tool("update_item", { id: note.id, notes: text });
    if (!answer.ok) {
      patch(note.id, null);
      notify({ text: `The note “${before}” could not be saved: ${answer.message}`, tone: "error" });
      return false;
    }
    touch();
    return true;
  }

  async function markDecision(note: Note) {
    const decision = !(patched[note.id]?.decision ?? note.decision);
    patch(note.id, { decision });
    const answer = await tool("update_item", { id: note.id, decision });
    if (!answer.ok) {
      patch(note.id, null);
      return notify({ text: `The note could not be ${decision ? "marked as a decision" : "taken back to a note"}: ${answer.message}`, tone: "error" });
    }
    touch();
    notify({
      text: decision ? `Marked “${inlinePlain(note.title)}” as a decision` : `“${inlinePlain(note.title)}” is a note again`,
      tone: "status",
      undo: () => void saving(tool("update_item", { id: note.id, decision: !decision })),
    });
  }

  async function removeNote(note: Note) {
    hide(note.id, true);
    const answer = await tool("delete_item", { id: note.id });
    if (!answer.ok) {
      hide(note.id, false);
      return notify({ text: `The note could not be deleted: ${answer.message}`, tone: "error" });
    }
    touch();
    notify({
      text: `Deleted the note “${inlinePlain(note.title)}”`,
      tone: "status",
      undo: () => {
        hide(note.id, false);
        void saving(post(`/api/items/${note.id}/restore`, {}));
      },
    });
    requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
  }

  return (
    <section className="task-section" aria-labelledby={`notes-${task.id}`}>
      <h3 id={`notes-${task.id}`} className="t-label task-section-head">
        Notes {notes && notes.length > 0 && <span className="t-meta">{notes.length}</span>}
      </h3>
      {notes === null && failed ? (
        <p className="inline-note" data-tone="alert">
          The notes could not be read: {failed}
        </p>
      ) : notes === null ? (
        <span className="skeleton" role="status" aria-label="Reading the notes" />
      ) : (
        notes.length > 0 && (
          <ul className="task-note-list">
            {[...notes]
              .reverse()
              .filter((note) => !hidden.has(note.id))
              .map((note) => (
                <NoteRow
                  key={note.id}
                  note={{ ...note, ...patched[note.id] }}
                  onSave={(text) => saveNote(note, text)}
                  onDecision={() => void markDecision(note)}
                  onDelete={() => void removeNote(note)}
                />
              ))}
          </ul>
        )
      )}
      {adding ? (
        <AddLine
          label="Add note"
          field="Note"
          onAdd={(text) => saving(tool("add_note", { parent: task.id, text }))}
          onDone={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
          }}
        />
      ) : (
        <button ref={addButton} type="button" className="task-add" onClick={() => setAdding(true)}>
          Add note
        </button>
      )}
    </section>
  );
}

// The event the task lives in: one of the coming weeks' events, a new one with the task's day, or none.
function EventField({ task }: { task: Item }) {
  const { saving } = useWorkspace();
  const [state, setState] = useState<EventLink | null>(null);
  const [events, setEvents] = useState<BrowsedEvent[] | null>(null);
  const [eventsFailed, setEventsFailed] = useState(false);

  const read = useCallback(() => {
    void get<EventLink>(`/api/items/${task.id}/event`).then((answer) => answer.ok && setState({ link: answer.link, event: answer.event }));
  }, [task.id]);
  useEffect(read, [read]);

  function loadEvents() {
    if (events) return;
    const from = today();
    const to = addDays(from, 30);
    const range = instantsOf(from, to);
    void tool<{ events: BrowsedEvent[] }>("browse_events", { from: range.from, to: range.to, fromDay: from, toDay: to }).then((answer) => {
      if (answer.ok) setEvents(answer.events);
      else setEventsFailed(true);
    });
  }

  async function link(event: BrowsedEvent) {
    const input = event.origin === "local" && event.localId ? { task: task.id, event: event.localId } : { task: task.id, account: event.accountId, calendar: event.calendarId, googleEvent: event.id };
    if (await saving(tool("link_task_event", input))) read();
  }

  async function createAndLink() {
    const day = task.dueOn ?? today();
    const when = task.dueTime
      ? (() => {
          const [h, m] = task.dueTime!.split(":").map(Number);
          const [y, mo, d] = day.split("-").map(Number);
          const start = new Date(y, mo - 1, d, h, m);
          return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() };
        })()
      : { startsOn: day };
    const made = await tool<{ event: { id: string } }>("create_event", { node: task.nodeId, title: inlinePlain(task.title), ...when });
    if (!(await saving(Promise.resolve(made))) || !made.ok) return;
    if (await saving(tool("link_task_event", { task: task.id, event: made.event.id }))) read();
  }

  const linked = state?.link ? (state.event ? `${state.event.title}, ${eventWhen(state.event)}` : "A Google event") : "No event";
  const entries: MenuEntry[] = [
    {
      kind: "group",
      label: "Coming events",
      entries:
        events === null
          ? [{ kind: "action", label: eventsFailed ? "The events could not be read" : "Reading the events…", disabled: true, onSelect: () => {} }]
          : events.length === 0
            ? [{ kind: "action", label: "No events in the next 30 days", disabled: true, onSelect: () => {} }]
            : events.slice(0, 40).map((event): MenuEntry => ({ kind: "action", label: event.title, detail: eventWhen(event), onSelect: () => void link(event) })),
    },
    { kind: "separator" },
    { kind: "action", label: "New event", detail: task.dueOn ? whenLabel(task.dueOn, task.dueTime ?? null) : "Today", onSelect: () => void createAndLink() },
    ...(state?.link
      ? [{ kind: "action", label: "Take it out of the event", onSelect: () => void saving(tool("unlink_task_event", { task: task.id })).then((ok) => ok && read()) } as MenuEntry]
      : []),
  ];
  return <Menu label={linked} name={`Event: ${linked}`} className="task-attr-menu" entries={entries} onOpenChange={(open) => open && loadEvents()} />;
}

function Versions({ id, task, onRestored }: { id: string; task: Item; onRestored: () => void }) {
  const { saving } = useWorkspace();
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  useEffect(() => {
    void get<{ revisions: Revision[] }>(`/api/items/${task.id}/revisions`).then((answer) => answer.ok && setRevisions(answer.revisions));
  }, [task.id]);
  return (
    <section className="task-section" aria-labelledby={id}>
      <h3 id={id} className="t-label task-section-head" tabIndex={-1}>
        Versions {revisions && revisions.length > 0 && <span className="t-meta">{revisions.length}</span>}
      </h3>
      {revisions === null ? (
        <p className="t-help">Reading the versions…</p>
      ) : revisions.length === 0 ? (
        <p className="t-help">No earlier versions: every change from now on leaves one here.</p>
      ) : (
        <ul className="task-version-list">
          {revisions.slice(0, 12).map((revision) => (
            <li key={revision.id} className="task-version">
              <span className="task-version-text">
                <span className="t-value">{inlinePlain(revision.snapshot.title)}</span>
                <span className="t-meta">
                  Before a change {sourceName(revision.source, revision.agentLabel).replace(/^By/, "by")}, {stampTime(revision.createdAt)}
                </span>
              </span>
              <Button
                size="sm"
                variant="quiet"
                aria-label={`Restore the version of ${stampTime(revision.createdAt)}`}
                onClick={() => void saving(post(`/api/revisions/${revision.id}/restore`, {})).then((ok) => ok && onRestored())}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { TaskData };
