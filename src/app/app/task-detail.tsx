"use client";

import { Link } from "@/components/ui/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, type RefObject } from "react";
import { GoogleMark } from "@/components/ui/brands";
import { FlipList } from "@/components/ui/flip-list";
import { Button, buttonClass } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Fold } from "@/components/ui/fold";
import {
  AddIcon,
  CloseIcon,
  CopiedIcon,
  DateIcon,
  DecisionIcon,
  DeleteIcon,
  DownIcon,
  DuplicateIcon,
  EventIcon,
  GeneralIcon,
  MailIcon,
  NoteIcon,
  PriorityIcon,
  UpIcon,
  VersionsIcon,
} from "@/components/ui/icons";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { RichEditor, RichText } from "@/components/ui/rich-editor";
import { Select, type SelectOption } from "@/components/ui/select";
import { useAutoHeight } from "@/components/ui/use-auto-height";
import { afterExit, focusAfterClose } from "@/components/ui/use-exit";
import { addDays, instantsOf, LOCALE, today } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { ASSISTANT_NAME } from "@/lib/product";
import { richTextToPlain } from "@/lib/rich-text";
import { cx } from "@/lib/utils";
import { get, post, tool, type Answer, type EventsFailure, type Item, type TreeNode } from "./client-api";
import { dueTimeOptions, NO_TIME } from "./due-times";
import { readEvents } from "./events-read";
import { PRIORITIES, SenderMark, sourceName } from "./item-parts";
import { subjectOf } from "./mail/subject";
import { startRound, withAccountMail, type ItemMail, type LinkedMail, type LinkedMessage, type MailFailure } from "./task-mail-read";
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
  useTaskActions,
  whenLabel,
  whenTone,
  type TaskData,
  type TaskDetailRequest,
} from "./task-row";
import { useWorkspace } from "./workspace";
import "../styles/mail.css";

type Note = { id: string; title: string; body: string | null; decision: boolean; createdAt: string };
type Revision = { id: string; createdAt: string; source: Item["source"]; agentLabel: string | null; snapshot: { title: string; deleted_at: string | null } };
type EventLink = { link: { eventId: string | null; googleEventId: string | null } | null; event: { title: string; allDay: boolean; startsOn: string | null; startsAt: string | null } | null };
type BrowsedEvent = { id: string; title: string; start: string; allDay: boolean; origin: "google" | "local"; localId: string | null; accountId: string; calendarId: string };
type Known = TaskDetailRequest["task"];
type SaveStatus = "" | "saving" | "saved" | "failed";

const SAVE: Record<"saving" | "saved" | "failed", string> = { saving: "Saving…", saved: "Saved", failed: "Not saved" };

const stamp = (iso: string) => new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" }).format(new Date(iso));
const stampTime = (iso: string) => new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const addedBy = (source: Item["source"], label: string | null, at: string) =>
  source === "manual" ? `Created ${at}` : `Created by ${source === "chat" ? ASSISTANT_NAME : (label ?? "a coding agent")} · ${at}`;
const colorOf = (tree: TreeNode[] | null, nodeId: string | null) => (nodeId ? (tree?.find((node) => node.id === nodeId)?.color ?? null) : null);

function eventWhen(event: { allDay: boolean; startsOn?: string | null; startsAt?: string | null; start?: string }): string {
  const day = event.allDay ? (event.startsOn ?? event.start?.slice(0, 10)) : null;
  if (day) return dayName(day);
  const at = event.startsAt ?? event.start;
  if (!at) return "";
  const date = new Date(at);
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${dayName(local)}, ${new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

function paintedFrom(id: string, known: Known): Item | null {
  if (!known?.title || known.status === undefined || known.priority === undefined || known.dueOn === undefined) return null;
  return {
    id,
    nodeId: known.nodeId ?? null,
    nodePath: known.path ?? null,
    parentId: known.parentId ?? null,
    type: "task",
    title: known.title,
    body: null,
    status: known.status,
    priority: known.priority ?? 4,
    dueOn: known.dueOn,
    dueTime: known.dueTime ?? null,
    source: known.source ?? "manual",
    agentLabel: known.agentLabel ?? null,
    createdAt: known.createdAt ?? new Date().toISOString(),
    completedAt: known.completedAt ?? null,
  };
}

function focusIsFree(dialog: HTMLDialogElement | null): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === dialog || active.matches(".task-detail-shape") || Boolean(active.closest(".task-detail-head"));
}

export function TaskDetail() {
  const { tree, saving, version } = useWorkspace();
  const router = useRouter();
  const actions = useTaskActions();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const eventTrigger = useRef<HTMLSpanElement>(null);
  const shape = useRef<HTMLDivElement>(null);
  const popupOpen = useRef(false);
  const landing = useRef<"title" | "event" | null>(null);
  const [request, setRequest] = useState<TaskDetailRequest | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveStatus>("");
  const [showVersions, setShowVersions] = useState(false);
  const [arriving, setArriving] = useState(false);
  const inner = useRef<HTMLDivElement>(null);
  useAutoHeight(dialog, inner, { ready: request !== null });
  const titleId = useId();
  const descId = useId();
  const versionsId = useId();

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

  const take = useCallback((found: Item) => {
    setItem(found);
    setLoaded(true);
    latest.current = found.body ?? "";
    confirmed.current = found.body ?? "";
    setBody(found.body ?? "");
    setStatus("");
  }, []);

  const load = useCallback(
    async (next: TaskDetailRequest) => {
      current.current = next.id;
      setFailed(null);
      const found = await readTaskItem(next.id);
      if (current.current !== next.id) return;
      if (!found) return setFailed("This task is not here any more: it was deleted.");
      take(found);
    },
    [take],
  );

  const show = useCallback(
    (next: TaskDetailRequest) => {
      clearTimeout(timer.current);
      setArriving(Boolean(dialog.current?.open));
      setRequest(next);
      setItem(paintedFrom(next.id, next.task));
      setLoaded(false);
      setShowVersions(false);
      setBody("");
      setStatus("");
      latest.current = "";
      confirmed.current = "";
      landing.current = next.focus === "event" ? "event" : "title";
      void load(next);
    },
    [load],
  );

  useEffect(
    () =>
      onOpenTaskDetail((next) => {
        const el = dialog.current;
        if (!el) return;
        if (el.open) return void flush().then(() => show(next));
        opener.current = document.activeElement as HTMLElement | null;
        show(next);
        el.showModal();
      }),
    [flush, show],
  );

  useEffect(() => {
    if (!item || !landing.current) return;
    const where = landing.current;
    requestAnimationFrame(() => {
      if (landing.current !== where) return;
      const target = where === "event" ? eventTrigger.current?.querySelector<HTMLElement>("button") : heading.current;
      if (!target) return;
      landing.current = null;
      if (focusIsFree(dialog.current)) target.focus({ preventScroll: true });
    });
  }, [item]);

  useEffect(() => {
    const id = current.current;
    if (!id || !dialog.current?.open || !item) return;
    void readTaskItem(id).then((found) => {
      if (found && current.current === id) setItem((was) => (was ? { ...found, body: was.body } : found));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  function close() {
    void flush().then(() => dialog.current?.close());
  }

  function leave(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    dialog.current?.close();
  }

  function go(href: string) {
    void flush().then(() => {
      dialog.current?.close();
      router.push(href);
    });
  }

  function onClosed() {
    void flush();
    const id = current.current;
    current.current = null;
    landing.current = null;
    const element = dialog.current;
    afterExit(element, () => {
      if (element?.open) return;
      setRequest(null);
      setItem(null);
      setLoaded(false);
      setShowVersions(false);
    });
    focusAfterClose(() => (id ? document.querySelector<HTMLElement>(`[data-item="${id}"] .task-open`) : null) ?? opener.current);
  }

  const list = request?.list ?? [];
  const index = request ? list.findIndex((entry) => entry.id === request.id) : -1;
  function step(by: number) {
    const next = list[index + by];
    if (!next) return;
    void flush().then(() => show({ id: next.id, task: next, list }));
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

  function openVersions(focus: boolean) {
    setShowVersions(true);
    if (focus) requestAnimationFrame(() => document.getElementById(versionsId)?.focus({ preventScroll: false }));
  }

  const task = item ? taskFromItem(item) : null;
  const more: MenuEntry[] = task
    ? [
        { kind: "action", label: "Duplicate", icon: DuplicateIcon, onSelect: () => void actions.duplicate(task) },
        { kind: "action", label: "Versions", icon: VersionsIcon, onSelect: () => openVersions(true) },
        { kind: "separator" },
        {
          kind: "action",
          label: "Delete",
          tone: "danger",
          icon: DeleteIcon,
          onSelect: () => {
            void flush().then(() => {
              dialog.current?.close();
              void actions.remove(task);
            });
          },
        },
      ]
    : [];

  const known = request?.task;
  const place = item ? { nodeId: item.nodeId, path: item.nodePath } : known?.title ? { nodeId: known.nodeId ?? null, path: known.path ?? null } : null;
  const isSubtask = Boolean(item ? item.parentId : known?.parentId);
  const first = index <= 0;
  const last = index < 0 || index >= list.length - 1;

  return (
    <dialog
      ref={dialog}
      className="dialog task-detail"
      aria-labelledby={titleId}
      onKeyDownCapture={(event) => {
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
        {request && (
          <div ref={inner} className="task-detail-in">
            <header className="task-detail-head">
              <p className="task-detail-path t-meta">
                {!place ? (
                  !failed && <span className="skeleton task-shape-path" />
                ) : place.nodeId ? (
                  <Link className="link link-meta" href={`/app/node/${place.nodeId}`} onClick={leave}>
                    <PlaceName path={place.path} color={colorOf(tree, place.nodeId)} />
                  </Link>
                ) : (
                  <PlaceName path={null} color={null} />
                )}
                {isSubtask && <span className="task-detail-kind">Subtask</span>}
              </p>
              <div className="task-detail-bar">
                {list.length > 1 && index >= 0 && (
                  <span className="task-detail-count t-meta">
                    <span aria-hidden="true">
                      {index + 1} / {list.length}
                    </span>
                    <span className="sr-only">{`Task ${index + 1} of ${list.length}`}</span>
                  </span>
                )}
                <Button
                  size="sm"
                  variant="quiet"
                  className="btn-icon"
                  title="Previous"
                  disabled={first}
                  onClick={() => step(-1)}
                  aria-label={first ? "Previous: this is the first task of the list" : undefined}
                >
                  <UpIcon />
                  <span className="sr-only">Previous</span>
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  className="btn-icon"
                  title="Next"
                  disabled={last}
                  onClick={() => step(1)}
                  aria-label={last ? "Next: this is the last task of the list" : undefined}
                >
                  <DownIcon />
                  <span className="sr-only">Next</span>
                </Button>
                {item && <Menu label="More" about={`for “${inlinePlain(item.title)}”`} entries={more} />}
                <Button size="sm" variant="quiet" className="btn-icon" title="Close" onClick={close}>
                  <CloseIcon />
                  <span className="sr-only">Close</span>
                </Button>
              </div>
            </header>
            {item ? (
              <TaskBody
                key={item.id}
                item={item}
                arriving={arriving}
                loaded={loaded}
                known={known}
                ids={{ title: titleId, desc: descId, versions: versionsId }}
                headingRef={heading}
                eventRef={eventTrigger}
                body={body}
                status={status}
                showVersions={showVersions}
                onToggleVersions={() => (showVersions ? setShowVersions(false) : openVersions(false))}
                onBody={(value) => {
                  setBody(value);
                  latest.current = value;
                  setStatus("");
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => void flush(), 700);
                }}
                onBodyBlur={() => void flush()}
                onEscape={close}
                onToggle={() => {
                  if (!task) return;
                  const was = item.status;
                  const id = item.id;
                  setItem({ ...item, status: was === "done" ? "open" : "done" });
                  void actions.complete(task).then((ok) => {
                    if (!ok && current.current === id) setItem((now) => (now && now.id === id ? { ...now, status: was } : now));
                  });
                }}
                onTitle={(title) => change({ title })}
                onChange={(input) => void change(input)}
                onMove={(value) => void movePlace(value)}
                onLeave={leave}
                onGo={go}
                onRestored={(restored) => current.current === restored.id && take(restored)}
              />
            ) : failed ? (
              <div className="task-detail-missing">
                <p className="inline-note" data-tone="alert">
                  {failed}
                </p>
                <Button size="sm" autoFocus onClick={() => dialog.current?.close()}>
                  Close
                </Button>
              </div>
            ) : (
              <DetailShape known={known} titleId={titleId} shapeRef={shape} arriving={arriving} />
            )}
          </div>
        )}
      </PopupLayerProvider>
    </dialog>
  );
}

type BodyProps = {
  item: Item;
  arriving: boolean;
  loaded: boolean;
  known: Known;
  ids: { title: string; desc: string; versions: string };
  headingRef: RefObject<HTMLDivElement | null>;
  eventRef: RefObject<HTMLSpanElement | null>;
  body: string;
  status: SaveStatus;
  showVersions: boolean;
  onToggleVersions: () => void;
  onBody: (value: string) => void;
  onBodyBlur: () => void;
  onEscape: () => void;
  onToggle: () => void;
  onTitle: (title: string) => Promise<void>;
  onChange: (input: Record<string, unknown>) => void;
  onMove: (value: string) => void;
  onLeave: (event: MouseEvent<HTMLAnchorElement>) => void;
  onGo: (href: string) => void;
  onRestored: (restored: Item) => void;
};

function TaskBody(props: BodyProps) {
  const { item, loaded, known, ids, body, status } = props;
  const { tree, version } = useWorkspace();
  const wait = useTaskMail(item);
  const isSubtask = Boolean(item.parentId);
  const tone = item.dueOn ? whenTone(item.dueOn) : undefined;
  const places: SelectOption[] = [{ value: "general", label: "General" }, ...(tree ?? []).map((node) => ({ value: node.id, label: node.path }))];
  const placeColor = colorOf(tree, item.nodeId);
  const hours = item.dueTime ? dueTimeOptions(item.dueTime) : dueTimeOptions(null).filter((option) => option.value !== NO_TIME);

  return (
    <div className={cx("task-detail-body", props.arriving && "fade-enter")} data-cascade>
      <div className="task-detail-title-row">
        <TaskCircle className="task-check" title={item.title} priority={item.priority} done={item.status === "done"} onToggle={props.onToggle} />
        <TitleField key={item.id} id={ids.title} title={item.title} headingRef={props.headingRef} onSave={props.onTitle} />
      </div>
      <div className="task-props task-detail-side" role="group" aria-label="Attributes">
        <span className="task-prop-pair">
          <Prop kind="date" empty={!item.dueOn} data-when={tone}>
            {item.dueOn ? <DateIcon className="task-prop-icon" /> : <AddIcon className="task-prop-icon" />}
            <DatePicker look="chip" label="Date" value={item.dueOn} display={item.dueOn ? whenLabel(item.dueOn, null) : "Add date"} onChange={(dueOn) => props.onChange({ dueOn })} />
          </Prop>
          {item.dueOn && (
            <Prop kind="time" data-when={item.dueTime ? tone : undefined} data-unset={item.dueTime ? undefined : ""}>
              <Select
                look="chip"
                label="Time"
                value={item.dueTime ?? null}
                placeholder="Add time"
                options={hours}
                onChange={(value) => props.onChange({ dueTime: value === NO_TIME ? null : value })}
              />
            </Prop>
          )}
        </span>
        <Prop kind="priority" data-priority={item.priority ?? 4}>
          <PriorityIcon className="task-prop-icon" />
          <Select look="chip" label="Priority" value={String(item.priority ?? 4)} options={PRIORITIES} onChange={(value) => props.onChange({ priority: Number(value) })} />
        </Prop>
        <Prop kind="place" data-color={placeColor ?? undefined}>
          {item.nodeId ? <span className="task-prop-disc" aria-hidden="true" /> : <GeneralIcon className="task-prop-icon" />}
          <Select look="chip" label="Client or project" value={item.nodeId ?? "general"} options={places} onChange={props.onMove} />
        </Prop>
        <EventField key={item.id} task={item} wrapRef={props.eventRef} />
        <MailProp wait={wait} onGo={props.onGo} />
      </div>
      <Closing task={item} version={version} />
      <div className="task-detail-desc">
        {loaded ? (
          <>
            <label className="sr-only" htmlFor={ids.desc}>
              Description
            </label>
            <RichEditor key={item.id} id={ids.desc} label="Description" value={body} placeholder="Add a description…" onChange={props.onBody} onBlur={props.onBodyBlur} onEscape={props.onEscape} />
          </>
        ) : (
          <div className="task-shape-desc" aria-hidden="true">
            <span className="skeleton" />
            {known?.description && <span className="skeleton" />}
          </div>
        )}
        <p className="task-detail-status" role="status" data-shown={status || undefined}>
          {status && <span className="t-meta">{SAVE[status]}</span>}
        </p>
      </div>
      <MailBox wait={wait} task={item} known={known} onLeave={props.onLeave} />
      {!isSubtask && <SubtaskSection key={`s-${item.id}`} task={item} version={version} expected={known?.subtasks?.total} />}
      <NoteSection key={`n-${item.id}`} task={item} version={version} expected={known?.notes} />
      <Fold open={props.showVersions} id={`${ids.versions}-fold`} lazy follow>
        <Versions key={`v-${item.id}`} id={ids.versions} task={item} version={version} onRestored={props.onRestored} />
      </Fold>
      <footer className="task-detail-foot">
        <p className="t-meta task-detail-origin">
          {addedBy(item.source, item.agentLabel, stamp(item.createdAt))}
        </p>
        <Button size="sm" variant="quiet" className="head-action" aria-expanded={props.showVersions} onClick={props.onToggleVersions}>
          <VersionsIcon />
          <span className="btn-label">Versions</span>
        </Button>
      </footer>
    </div>
  );
}

function Prop({ kind, empty, children, ref, ...data }: { kind: string; empty?: boolean; children: ReactNode; ref?: Ref<HTMLSpanElement> } & { [key: `data-${string}`]: string | number | undefined }) {
  return (
    <span ref={ref} className="task-prop" data-prop={kind} data-empty={empty || undefined} {...data}>
      {children}
    </span>
  );
}

function DetailShape({ known, titleId, shapeRef, arriving }: { known: Known; titleId: string; shapeRef: RefObject<HTMLDivElement | null>; arriving: boolean }) {
  useEffect(() => {
    const dialog = shapeRef.current?.closest("dialog") ?? null;
    if (focusIsFree(dialog)) shapeRef.current?.focus({ preventScroll: true });
  }, [shapeRef]);
  return (
    <div ref={shapeRef} className={cx("task-detail-body task-detail-shape", arriving && "fade-enter")} role="status" aria-busy="true" aria-label="Loading the task" tabIndex={-1}>
      <div className="task-detail-title-row">
        <span className="task-shape-circle" aria-hidden="true" />
        {known?.title ? (
          <div className="task-detail-title">
            <h2 id={titleId} className="task-detail-title-text">
              <InlineText text={known.title} />
            </h2>
          </div>
        ) : (
          <span className="skeleton task-shape-title" />
        )}
      </div>
      <div className="task-props" aria-hidden="true">
        <span className="skeleton task-shape-chip" />
        <span className="skeleton task-shape-chip" />
        <span className="skeleton task-shape-chip" />
        <span className="skeleton task-shape-chip" />
      </div>
      <div className="task-detail-desc" aria-hidden="true">
        <div className="task-shape-desc">
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      </div>
      <div className="task-section" aria-hidden="true">
        <span className="skeleton task-shape-head" />
        <ShapeRows count={2} />
      </div>
    </div>
  );
}

function ShapeRows({ count, mark = "circle" }: { count: number; mark?: "circle" | "sender" | "glyph" }) {
  return (
    <ul className="task-shape-rows" data-mark={mark} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="task-shape-row">
          <span className="task-shape-mark" />
          <span className="skeleton" />
        </li>
      ))}
    </ul>
  );
}

function Closing({ task, version }: { task: Item; version: number }) {
  const [decision, setDecision] = useState<{ at: string; note: Note | null } | null>(null);
  const at = task.status === "done" ? (task.completedAt ?? null) : null;
  useEffect(() => {
    if (!at) return;
    let live = true;
    void tool<{ notes: Note[] }>("list_notes", { parent: task.id, decisionsOnly: true }).then((answer) => {
      if (!live || !answer.ok) return;
      setDecision({ at, note: answer.notes.find((note) => Date.parse(note.createdAt) === Date.parse(at)) ?? null });
    });
    return () => {
      live = false;
    };
  }, [task.id, at, version]);
  const note = at && decision?.at === at ? decision.note : null;
  if (!at || !note) return null;
  return (
    <div className="task-closing fade-enter">
      <span className="task-closing-mark" aria-hidden="true">
        <CopiedIcon />
      </span>
      <div className="task-closing-text">
        <p className="task-closing-title">
          <span className="t-name">{inlinePlain(note.title)}</span>
          <span className="t-meta">{`Completed ${stamp(at)}`}</span>
        </p>
        {note.body && <RichText className="t-meta task-closing-body" html={note.body} />}
      </div>
    </div>
  );
}

type TaskWait = { accountId: string | null; waitsFor: string; since: string; dismissed: string[] };
type MailMessageRow = LinkedMessage;
type MailDetail = LinkedMail & { mail: TaskWait | null };
type MailAccount = { id: string; email: string; nodeIds: string[] };
type RepliesRead = { replies: MailMessageRow[]; next: Record<string, string>; failures: MailFailure[] };

const WAIT_NONE = "none";
const WAIT_PLACE = "place";
const REPLIES = 20;

const replyKey = (reply: { accountId: string; id: string }) => `${reply.accountId}:${reply.id}`;
const newestFirst = (a: MailMessageRow, b: MailMessageRow) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0);

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

function useTaskMail(task: Item) {
  const { tree, notify, touch, saving, version } = useWorkspace();
  const [detail, setDetail] = useState<{ id: string; read: MailDetail | null; error: string | null; reading: number } | null>(null);
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
  const [pending, setPending] = useState<{ id: string; account: string | null } | null>(null);
  const [words, setWords] = useState<{ id: string; value: string } | null>(null);
  const [replies, setReplies] = useState<{ key: string; read: RepliesRead | null } | null>(null);
  const [readingMore, setReadingMore] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const closeTask = useCompleteTask();

  useEffect(() => {
    let live = true;
    void Promise.all([tool<MailDetail & { mailToRead: string[] }>("get_item", { id: task.id }), get<{ accounts: MailAccount[] }>("/api/accounts")]).then(([answer, listed]) => {
      if (!live) return;
      if (listed.ok) setAccounts(listed.accounts);
      if (!answer.ok) return setDetail((now) => ({ id: task.id, read: now?.id === task.id ? now.read : null, error: answer.message, reading: 0 }));
      setDetail((now) => {
        const shown = now?.id === task.id ? now.read : null;
        const first = { messages: answer.messages, mailFailures: answer.mailFailures };
        return { id: task.id, read: { mail: answer.mail, ...startRound(shown, first, answer.mailToRead) }, error: null, reading: answer.mailToRead.length };
      });
      for (const account of answer.mailToRead) {
        const email = (listed.ok ? listed.accounts.find((entry) => entry.id === account)?.email : undefined) ?? "one account";
        void tool<ItemMail>("list_item_mail", { id: task.id, account }).then((mail) => {
          if (!live) return;
          setDetail((now) => (now?.id === task.id && now.read ? { ...now, read: { ...now.read, ...withAccountMail(now.read, { id: account, email }, mail) }, reading: now.reading - 1 } : now));
        });
      }
    });
    return () => {
      live = false;
    };
  }, [task.id, version]);

  const read = detail?.id === task.id ? detail.read : null;
  const error = detail?.id === task.id ? detail.error : null;
  const reading = detail?.id === task.id ? detail.reading : 0;
  const mail = read?.mail ?? null;
  const waitingHere = pending?.id === task.id ? pending : null;
  const seen = new Set(accountsSeenFrom(tree, accounts ?? [], task.nodeId));
  const visible = (accounts ?? []).filter((account) => seen.has(account.id));
  const placeLabel = task.nodeId === null ? "All accounts" : "All accounts of its client or project";
  const asking = Boolean(mail) || Boolean(waitingHere);
  const options: SelectOption[] = [
    ...(asking ? [{ value: WAIT_NONE, label: "Don’t wait for mail" }] : []),
    ...(visible.length > 0 ? [{ value: WAIT_PLACE, label: placeLabel }] : []),
    ...visible.map((account) => ({ value: account.id, label: account.email, mark: GoogleMark })),
  ];
  const value = waitingHere ? (waitingHere.account ?? WAIT_PLACE) : mail ? (mail.accountId ?? WAIT_PLACE) : null;
  const wordsValue = words?.id === task.id ? words.value : (mail?.waitsFor ?? "");
  const account = waitingHere ? waitingHere.account : mail ? mail.accountId : undefined;
  const where = account === undefined ? null : account === null ? placeLabel : (accounts?.find((entry) => entry.id === account)?.email ?? "An account");
  const lookIn = mail ? visible.filter((entry) => mail.accountId === null || entry.id === mail.accountId) : [];
  const unseen = mail !== null && accounts !== null && lookIn.length === 0;
  const repliesKey = mail && task.status === "open" && !unseen ? `${task.id}:${mail.accountId ?? ""}:${mail.waitsFor}:${lookIn.map((entry) => entry.id).join(",")}` : null;

  useEffect(() => {
    if (!repliesKey) return;
    let live = true;
    void Promise.all(lookIn.map((entry) => tool<RepliesRead>("list_task_replies", { task: task.id, account: entry.id, limit: REPLIES }))).then((answers) => {
      if (!live) return;
      setReplies((now) => {
        const read = joinReads(answers, lookIn);
        const failed = new Set(read.failures.map((failure) => failure.accountEmail));
        const kept = now?.key === repliesKey && now.read ? now.read.replies.filter((reply) => failed.has(reply.accountEmail)) : [];
        return { key: repliesKey, read: kept.length > 0 ? joinReads(answers, lookIn, kept) : read };
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repliesKey, version]);
  const shown = replies?.key === repliesKey ? replies.read : null;

  async function readMore() {
    if (!shown || !repliesKey) return;
    const pages = Object.entries(shown.next);
    setReadingMore(true);
    const answers = await Promise.all(pages.map(([entry, pageToken]) => tool<RepliesRead>("list_task_replies", { task: task.id, account: entry, limit: REPLIES, pageToken })));
    setReadingMore(false);
    const emails = pages.map(([entry]) => ({ id: entry, email: lookIn.find((each) => each.id === entry)?.email ?? "An account" }));
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
        void saving(
          tool(
            "set_task_mail",
            previous
              ? { task: task.id, account: previous.accountId, words: previous.waitsFor, since: previous.since, dismissed: previous.dismissed }
              : { task: task.id, waiting: false },
          ).then((back) => (back.ok ? back : { ...back, message: `What “${inlinePlain(task.title)}” waited for could not come back: ${back.message}` })),
        ),
    });
  }

  function choose(next: string) {
    if (next === value) return;
    if (next === WAIT_NONE) {
      if (waitingHere) return setPending(null);
      return void save({ waiting: false }, `“${inlinePlain(task.title)}” waits for no mail now`);
    }
    const chosen = next === WAIT_PLACE ? null : next;
    if (!mail) return setPending({ id: task.id, account: chosen });
    const there = chosen ? (visible.find((entry) => entry.id === chosen)?.email ?? "that account") : placeLabel.toLowerCase();
    void save({ account: chosen }, `“${inlinePlain(task.title)}” waits for its mail in ${there}`);
  }

  function saveWords() {
    const next = wordsValue.trim();
    if (waitingHere) {
      if (!next) return notify({ text: "Say what it waits for: who sends it or what it is about.", tone: "error" });
      return void save({ account: waitingHere.account, words: next }, `“${inlinePlain(task.title)}” waits for mail with “${next}”`);
    }
    if (!mail) return;
    if (!next) return setWords(null);
    if (next === mail.waitsFor) return;
    void save({ words: next }, `“${inlinePlain(task.title)}” waits for mail with “${next}”`);
  }

  async function complete(reply: MailMessageRow, outcome: string) {
    if (await closeTask(task, reply, outcome)) setChoosing(null);
  }

  function stopChoosing(trigger: string) {
    setChoosing(null);
    focusAfterClose(() => document.getElementById(trigger));
  }

  async function dismiss(reply: MailMessageRow) {
    const answer = await tool("dismiss_reply", { task: task.id, account: reply.accountId, id: reply.id, dismissed: true });
    if (!answer.ok) return notify({ text: `“${subjectOf(reply)}” could not be ruled out: ${answer.message}`, tone: "error" });
    setReplies((current) => (current?.read ? { ...current, read: { ...current.read, replies: current.read.replies.filter((entry) => replyKey(entry) !== replyKey(reply)) } } : current));
    notify({
      text: `“${subjectOf(reply)}” is not what “${inlinePlain(task.title)}” waits for`,
      tone: "status",
      undo: () => void saving(tool("dismiss_reply", { task: task.id, account: reply.accountId, id: reply.id, dismissed: false })),
    });
  }

  return {
    read,
    error,
    reading,
    mail,
    waitingHere,
    asking,
    visible,
    options,
    value,
    where,
    wordsValue,
    setWordsValue: (next: string) => setWords({ id: task.id, value: next }),
    resetWords: () => setWords(null),
    unseen,
    shown,
    readingMore,
    choosing,
    setChoosing,
    choose,
    saveWords,
    readMore,
    complete,
    stopChoosing,
    dismiss,
  };
}
type TaskMail = ReturnType<typeof useTaskMail>;

function MailProp({ wait, onGo }: { wait: TaskMail; onGo: (href: string) => void }) {
  const waiting = wait.mail ? "waiting" : "none";
  if (!wait.read) {
    if (wait.error) return null;
    return (
      <Prop kind="mail" data-task-mail={waiting}>
        <span className="skeleton task-shape-chip" role="status" aria-label="Loading the mail it waits for" />
      </Prop>
    );
  }
  if (wait.options.length === 0) {
    return (
      <Prop kind="mail" empty data-task-mail={waiting}>
        <AddIcon className="task-prop-icon" />
        <Menu
          label="Wait for mail"
          name="Mail: wait for mail"
          entries={[
            { kind: "action", label: "No account is connected here", disabled: true, onSelect: () => {} },
            { kind: "action", label: "Connect Google account", icon: GoogleMark, onSelect: () => onGo("/app/settings") },
          ]}
        />
      </Prop>
    );
  }
  return (
    <Prop kind="mail" empty={!wait.asking} data-task-mail={waiting} data-waiting={wait.mail ? "" : undefined}>
      {wait.asking ? <MailIcon className="task-prop-icon" /> : <AddIcon className="task-prop-icon" />}
      <Select look="chip" label="Waits for mail in" value={wait.value} placeholder={wait.mail ? "Choose account" : "Wait for mail"} options={wait.options} onChange={wait.choose} />
    </Prop>
  );
}

function MailBox({ wait, task, known, onLeave }: { wait: TaskMail; task: Item; known: Known; onLeave: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const headId = useId();
  const wordsId = useId();
  const wordsHelpId = useId();
  const repliesId = useId();
  const { read, mail, waitingHere, shown } = wait;
  const open = task.status === "open";

  if (!read) {
    if (wait.error) {
      return (
        <p className="inline-note task-wait-note" data-tone="alert" data-task-mail="none">
          Its mail could not be loaded: {wait.error}
        </p>
      );
    }
    if (!known?.mail) return null;
    return (
      <section className="task-wait" aria-busy="true" aria-label="Loading the mail it waits for">
        <div className="task-wait-head">
          <MailIcon className="task-wait-icon" />
          <span className="skeleton task-shape-head" />
        </div>
        <div className="task-wait-part">
          <ShapeRows count={2} mark="sender" />
        </div>
      </section>
    );
  }

  const linked = read.messages;
  const readingLinked = linked.length === 0 && wait.reading > 0;
  if (!wait.asking && linked.length === 0 && !readingLinked && read.mailFailures.length === 0 && !wait.error) return null;
  const title = waitingHere ? "Wait for mail" : mail ? (open ? "Waiting for mail" : "Waited for mail") : "Mail";
  const failures = shown?.failures ?? [];

  return (
    <section className="task-wait" data-task-mail={mail ? "waiting" : "none"} data-state={waitingHere ? "new" : mail ? (open ? "waiting" : "done") : "linked"} aria-labelledby={headId}>
      <header className="task-wait-head">
        <MailIcon className="task-wait-icon" />
        <h3 id={headId} className="task-wait-title">
          {title}
        </h3>
        {wait.asking && wait.where && <span className="task-wait-where t-meta">{wait.where}</span>}
        {!wait.asking && linked.length > 0 && <span className="task-wait-where t-meta">{linked.length}</span>}
        {mail && open && !waitingHere && (
          <Button size="sm" variant="quiet" className="head-action task-wait-stop" onClick={() => wait.choose(WAIT_NONE)}>
            Stop waiting
          </Button>
        )}
      </header>
      {wait.error && (
        <p className="inline-note task-wait-note" data-tone="alert">
          Its mail could not be refreshed: {wait.error}. Showing the last version loaded.
        </p>
      )}
      {(waitingHere || (mail && open)) && (
        <div className="task-wait-part task-mail-words">
          <label className="t-label" htmlFor={wordsId}>
            What it waits for
          </label>
          <input
            id={wordsId}
            className="field"
            value={wait.wordsValue}
            placeholder="Acme invoice"
            maxLength={200}
            autoFocus={Boolean(waitingHere)}
            aria-describedby={wordsHelpId}
            onChange={(event) => wait.setWordsValue(event.target.value)}
            onBlur={() => {
              if (mail) wait.saveWords();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                wait.saveWords();
              }
              if (event.key === "Escape" && wait.wordsValue !== (mail?.waitsFor ?? "")) {
                event.preventDefault();
                event.stopPropagation();
                wait.resetWords();
              }
            }}
          />
          <p id={wordsHelpId} className="t-meta task-mail-help">
            Every word must appear in the sender or the subject of new mail.
          </p>
          {waitingHere && (
            <div className="task-mail-start">
              <Button size="sm" variant="primary" onClick={wait.saveWords} disabled={!wait.wordsValue.trim()}>
                Start waiting
              </Button>
              <Button size="sm" variant="quiet" onClick={() => wait.choose(WAIT_NONE)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
      {mail && !open && !waitingHere && linked.length === 0 && !readingLinked && <p className="t-meta task-wait-part">Completed without choosing a reply.</p>}
      {mail && open && !waitingHere && (
        <section className="task-wait-part task-replies" aria-labelledby={repliesId}>
          <div className="task-replies-head">
            <h4 className="task-replies-title" id={repliesId}>
              Possible replies
              {shown && shown.replies.length > 0 && <span className="task-section-count">{shown.replies.length}</span>}
            </h4>
            <p className="t-meta">Arrived since {stamp(mail.since)}. You decide which one answers it.</p>
          </div>
          {wait.unseen ? (
            wait.visible.length > 0 ? (
              <p className="t-help">That account is no longer connected here. Choose another.</p>
            ) : (
              <div className="task-replies-empty">
                <p className="t-help">No account is connected where this task lives anymore: connect one, or stop waiting.</p>
                <Link href="/app/settings" className={buttonClass({ size: "sm" })} onClick={onLeave}>
                  <GoogleMark />
                  <span className="btn-label">Connect Google account</span>
                </Link>
              </div>
            )
          ) : !shown ? (
            <div role="status" aria-label="Loading its possible replies">
              <ShapeRows count={2} mark="sender" />
            </div>
          ) : shown.replies.length === 0 ? (
            failures.length === 0 && <p className="t-help task-replies-empty">No matching mail yet.</p>
          ) : (
            <ul className="task-reply-list">
              {shown.replies.map((reply, index) => {
                const key = replyKey(reply);
                const trigger = `${repliesId}-${index}`;
                const from = reply.from.name ?? reply.from.email;
                return (
                  <li key={key} className="task-reply" data-reply-open={wait.choosing === key ? "" : undefined}>
                    <SenderMark name={from} email={reply.from.email} />
                    <Link className="task-mail-link" href={`/app/mail?message=${encodeURIComponent(key)}`} onClick={onLeave}>
                      <span className="t-value">{subjectOf(reply)}</span>
                      <span className="t-meta">
                        {from} · {stamp(reply.receivedAt)}
                      </span>
                    </Link>
                    <div className="task-reply-actions">
                      <Button
                        id={trigger}
                        size="sm"
                        aria-expanded={wait.choosing === key}
                        onClick={() => (wait.choosing === key ? wait.stopChoosing(trigger) : wait.setChoosing(key))}
                      >
                        Mark as answer
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => void wait.dismiss(reply)}>
                        Dismiss
                      </Button>
                    </div>
                    {wait.choosing === key && (
                      <TaskOutcome question="How did it end?" title={task.title} onClose={(outcome) => wait.complete(reply, outcome)} onCancel={() => wait.stopChoosing(trigger)} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {shown && Object.keys(shown.next).length > 0 && (
            <Button size="sm" variant="quiet" className="head-action task-replies-more" onClick={() => void wait.readMore()} disabled={wait.readingMore} aria-busy={wait.readingMore || undefined}>
              {wait.readingMore ? "Loading more replies…" : "Show more replies"}
            </Button>
          )}
          {failures.map((failure) => (
            <p key={failure.accountEmail} className="inline-note" data-tone="alert">
              The mail of {failure.accountEmail} could not be loaded: {failure.reason}
            </p>
          ))}
        </section>
      )}
      {(linked.length > 0 || readingLinked) && (
        <div className="task-wait-part task-linked">
          {wait.asking && <h4 className="task-replies-title">Linked to it</h4>}
          {readingLinked && (
            <div role="status" aria-label="Loading its mail">
              <ShapeRows count={1} mark="sender" />
            </div>
          )}
          {linked.length > 0 && (
            <ul className="task-mail-list" aria-label="Its mail" aria-busy={wait.reading > 0 || undefined}>
              {linked.map((message) => {
                const from = message.from.name ?? message.from.email;
                return (
                  <li key={replyKey(message)} className="task-linked-row fade-enter">
                    <SenderMark name={from} email={message.from.email} />
                    <Link className="task-mail-link" href={`/app/mail?message=${encodeURIComponent(replyKey(message))}`} onClick={onLeave}>
                      <span className="t-value">{subjectOf(message)}</span>
                      <span className="t-meta">
                        {from} · {stamp(message.receivedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {read.mailFailures.map((failure) => (
        <p key={failure.accountEmail} className="inline-note task-wait-note" data-tone="alert">
          The mail of {failure.accountEmail} could not be loaded: {failure.reason}
        </p>
      ))}
    </section>
  );
}

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

  function finish(save: boolean, refocus = true) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = value.replace(/\s+/g, " ").trim();
    if (save && next && next !== title) void onSave(next);
    if (refocus) focusAfterClose(() => headingRef.current?.querySelector<HTMLElement>(".task-detail-title-edit"));
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
        onBlur={(event) => finish(true, !event.relatedTarget)}
      />
    );
  }
  return (
    <div ref={headingRef} className="task-detail-title" tabIndex={-1}>
      <h2 id={id} className="task-detail-title-text">
        <InlineText text={title} />
      </h2>
      <button type="button" className="task-detail-title-edit" aria-label={`Edit the title “${inlinePlain(title)}”`} onClick={start} />
    </div>
  );
}

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
      <Button size="sm" variant="quiet" onClick={onDone}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" onClick={() => void add()} aria-busy={busy} disabled={busy || !value.trim()}>
        {label}
      </Button>
    </div>
  );
}

function SectionHead({ id, name, figure, children, tabIndex }: { id: string; name: string; figure?: string | null; children?: ReactNode; tabIndex?: number }) {
  return (
    <h3 id={id} className="task-section-head" tabIndex={tabIndex}>
      <span className="task-section-name">{name}</span>
      {figure && <span className="task-section-count">{figure}</span>}
      {children}
    </h3>
  );
}

function SubtaskSection({ task, version, expected }: { task: Item; version: number; expected?: number }) {
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
  const total = items?.length ?? 0;
  const list = (items ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    nodeId: item.nodeId,
    path: item.nodePath,
    parentId: item.parentId,
    status: item.status,
    priority: item.priority,
    dueOn: item.dueOn,
    dueTime: item.dueTime ?? null,
    source: item.source,
    agentLabel: item.agentLabel,
    createdAt: item.createdAt,
    completedAt: item.completedAt ?? null,
  }));
  return (
    <section className="task-section" data-section="subtasks" aria-labelledby={`sub-${task.id}`}>
      <SectionHead id={`sub-${task.id}`} name="Subtasks" figure={items && total > 0 ? `${done}/${total}` : null}>
        {items && total > 0 && (
          <span className="task-progress" aria-hidden="true" data-complete={done === total || undefined}>
            <span className="task-progress-fill" style={{ inlineSize: `${(done / total) * 100}%` }} />
          </span>
        )}
      </SectionHead>
      {items === null && failed ? (
        <p className="inline-note" data-tone="alert">
          The subtasks could not be loaded: {failed}
        </p>
      ) : items === null ? (
        (expected ?? 1) > 0 && (
          <div role="status" aria-label="Loading the subtasks">
            <ShapeRows count={Math.min(expected ?? 1, 5)} />
          </div>
        )
      ) : (
        items.length > 0 && (
          <FlipList className="task-subtask-list">
            {items.map((item) => (
              <li key={item.id} className="task-subtask" data-flip-key={item.id} data-done={item.status === "done" || undefined}>
                <TaskCircle title={item.title} priority={item.priority} done={item.status === "done"} onToggle={() => void saving(tool("update_item", { id: item.id, status: item.status === "done" ? "open" : "done" }))} />
                <button type="button" className="task-subtask-title t-value" onClick={() => openTaskDetail({ id: item.id, task: list.find((entry) => entry.id === item.id), list })}>
                  {inlinePlain(item.title)}
                </button>
              </li>
            ))}
          </FlipList>
        )
      )}
      {adding ? (
        <AddLine
          label="Add subtask"
          field="Subtask"
          onAdd={(title) => saving(tool("create_task", { parent: task.id, title }))}
          onDone={() => {
            setAdding(false);
            focusAfterClose(() => addButton.current);
          }}
        />
      ) : (
        <button ref={addButton} type="button" className="task-add" onClick={() => setAdding(true)}>
          <AddIcon />
          Add subtask
        </button>
      )}
    </section>
  );
}

function NoteRow({ note, onSave, onDecision, onDelete }: { note: Note; onSave: (text: string) => Promise<boolean>; onDecision: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const text = note.body ? richTextToPlain(note.body).trim() || note.title : note.title;

  function start() {
    done.current = false;
    setValue(text);
    setEditing(true);
    setTimeout(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 60);
  }

  function finish(save: boolean, refocus = true) {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    setEditing(false);
    if (save && next && next !== text) void onSave(next);
    if (refocus) focusAfterClose(() => editButton.current);
  }

  const plain = inlinePlain(note.title);
  return (
    <li className="task-note t-body" data-note={note.id} data-flip-key={note.id} data-decision={note.decision || undefined}>
      {note.decision ? <DecisionIcon className="task-note-glyph" /> : <NoteIcon className="task-note-glyph" />}
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
          onBlur={(event) => finish(true, !event.relatedTarget)}
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
            { kind: "action", label: note.decision ? "Mark as note" : "Mark as decision", onSelect: onDecision },
            { kind: "separator" },
            { kind: "action", label: "Delete", tone: "danger", onSelect: onDelete },
          ]}
        />
      </div>
    </li>
  );
}

function NoteSection({ task, version, expected }: { task: Item; version: number; expected?: number }) {
  const { saving, notify, touch } = useWorkspace();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
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
    focusAfterClose(() => addButton.current);
  }

  const shownNotes = (notes ?? []).filter((note) => !hidden.has(note.id));
  return (
    <section className="task-section" data-section="notes" aria-labelledby={`notes-${task.id}`}>
      <SectionHead id={`notes-${task.id}`} name="Notes" figure={notes && shownNotes.length > 0 ? String(shownNotes.length) : null} />
      {notes === null && failed ? (
        <p className="inline-note" data-tone="alert">
          The notes could not be loaded: {failed}
        </p>
      ) : notes === null ? (
        (expected ?? 1) > 0 && (
          <div role="status" aria-label="Loading the notes">
            <ShapeRows count={Math.min(expected ?? 1, 5)} mark="glyph" />
          </div>
        )
      ) : (
        shownNotes.length > 0 && (
          <FlipList className="task-note-list">
            {[...shownNotes].reverse().map((note) => (
              <NoteRow
                key={note.id}
                note={{ ...note, ...patched[note.id] }}
                onSave={(text) => saveNote(note, text)}
                onDecision={() => void markDecision(note)}
                onDelete={() => void removeNote(note)}
              />
            ))}
          </FlipList>
        )
      )}
      {adding ? (
        <AddLine
          label="Add note"
          field="Note"
          onAdd={(text) => saving(tool("add_note", { parent: task.id, text }))}
          onDone={() => {
            setAdding(false);
            focusAfterClose(() => addButton.current);
          }}
        />
      ) : (
        <button ref={addButton} type="button" className="task-add" onClick={() => setAdding(true)}>
          <AddIcon />
          Add note
        </button>
      )}
    </section>
  );
}

function EventField({ task, wrapRef }: { task: Item; wrapRef: Ref<HTMLSpanElement> }) {
  const { saving } = useWorkspace();
  const [state, setState] = useState<EventLink | null>(null);
  const [events, setEvents] = useState<BrowsedEvent[] | null>(null);
  const [eventsFailed, setEventsFailed] = useState(false);
  const [failures, setFailures] = useState<EventsFailure[]>([]);
  const reading = useRef(false);

  const read = useCallback(() => {
    void get<EventLink>(`/api/items/${task.id}/event`).then((answer) => answer.ok && setState({ link: answer.link, event: answer.event }));
  }, [task.id]);
  useEffect(read, [read]);

  function loadEvents() {
    if ((events && failures.length === 0) || reading.current) return;
    reading.current = true;
    setEventsFailed(false);
    const from = today();
    const to = addDays(from, 30);
    const range = instantsOf(from, to);
    void readEvents<BrowsedEvent>({ from: range.from, to: range.to, fromDay: from, toDay: to }).then((answer) => {
      reading.current = false;
      if (answer.ok) {
        setEvents(answer.events);
        setFailures(answer.failures);
      } else setEventsFailed(true);
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

  const linked = state?.link ? (state.event ? `${state.event.title}, ${eventWhen(state.event)}` : "A Google Calendar event") : null;
  const said = (words: string): MenuEntry => ({ kind: "action", label: words, disabled: true, onSelect: () => {} });
  const notRead = [...new Set(failures.map((failure) => failure.accountEmail || "the workspace's calendar"))].map((who) => said(`Not read: ${who}`));
  const entries: MenuEntry[] = [
    {
      kind: "group",
      label: "Upcoming events",
      entries:
        events === null
          ? [said(eventsFailed ? "The events could not be loaded" : "Loading the events…")]
          : [
              ...notRead,
              ...(events.length === 0 && notRead.length === 0
                ? [said("No events in the next 30 days")]
                : events.slice(0, 40).map((event): MenuEntry => ({ kind: "action", label: event.title, detail: eventWhen(event), onSelect: () => void link(event) }))),
            ],
    },
    { kind: "separator" },
    { kind: "action", label: "New calendar event", detail: task.dueOn ? whenLabel(task.dueOn, task.dueTime ?? null) : "Today", onSelect: () => void createAndLink() },
    ...(state?.link
      ? [{ kind: "action", label: "Unlink calendar event", onSelect: () => void saving(tool("unlink_task_event", { task: task.id })).then((ok) => ok && read()) } as MenuEntry]
      : []),
  ];
  return (
    <Prop kind="event" empty={!linked} ref={wrapRef}>
      {linked ? <EventIcon className="task-prop-icon" /> : <AddIcon className="task-prop-icon" />}
      <Menu label={linked ?? "Link calendar event"} name={`Calendar event: ${linked ?? "None linked"}`} className="task-attr-menu" entries={entries} onOpenChange={(open) => open && loadEvents()} />
    </Prop>
  );
}

function Versions({ id, task, version, onRestored }: { id: string; task: Item; version: number; onRestored: (restored: Item) => void }) {
  const { saving } = useWorkspace();
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  useEffect(() => {
    let live = true;
    void get<{ revisions: Revision[] }>(`/api/items/${task.id}/revisions`).then((answer) => live && answer.ok && setRevisions(answer.revisions));
    return () => {
      live = false;
    };
  }, [task.id, version]);
  async function restore(revisionId: string) {
    const answer = await post<{ item: Item }>(`/api/revisions/${revisionId}/restore`, {});
    if (!(await saving(Promise.resolve(answer))) || !answer.ok) return;
    onRestored(answer.item);
  }
  return (
    <section className="task-section" data-section="versions" aria-labelledby={id}>
      <SectionHead id={id} name="Versions" figure={revisions && revisions.length > 0 ? String(revisions.length) : null} tabIndex={-1} />
      {revisions === null && <p className="t-help">Loading the versions…</p>}
      {revisions !== null && (
        <Fold open={revisions.length === 0} id={`${id}-none`}>
          <p className="t-help">No earlier versions: every change from now on leaves one here.</p>
        </Fold>
      )}
      {revisions !== null && revisions.length > 0 && (
        <FlipList className="task-version-list">
          {revisions.slice(0, 12).map((revision) => (
            <li key={revision.id} className="task-version" data-flip-key={revision.id}>
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
                onClick={() => void restore(revision.id)}
              >
                Restore
              </Button>
            </li>
          ))}
        </FlipList>
      )}
    </section>
  );
}

export type { TaskData };
