"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LinkMark } from "@/components/ui/brands";
import { DatePicker } from "@/components/ui/date-picker";
import { landFrom, useFlip } from "@/components/ui/flip";
import { Fold } from "@/components/ui/fold";
import { ByAgentIcon, ByChatIcon, DateIcon, DecisionIcon, DeleteIcon, DuplicateIcon, LinkIcon, MailIcon, MoveIcon, NoteIcon, PriorityIcon, SubtasksIcon, TimeIcon } from "@/components/ui/icons";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { addDays, today, type Day } from "@/lib/dates";
import { inlineLink, inlinePieces, inlinePlain } from "@/lib/inline-links";
import { currentLanguage } from "@/lib/language";
import { countedNow, translateNow, useStrings } from "@/lib/strings";
import type { TaskRow } from "@/lib/tools/tasks";
import { cx } from "@/lib/utils";
import { post, tool, type Item, type TreeNode } from "./client-api";
import { PathText, priorityOptions, sourceName } from "./item-parts";
import { useWorkspace } from "./workspace";
import "../styles/task.css";

export type TaskData = Omit<TaskRow, "mail"> & { mail?: TaskRow["mail"] };

export type WhenTone = "overdue" | "today" | "tomorrow" | "week" | "later";

const dateOf = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const localeNow = () => (typeof document === "undefined" ? "en" : currentLanguage());

export function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(localeNow(), { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

export function dayName(day: Day, now: Day = today()): string {
  if (day === now) return translateNow("date.today");
  if (day === addDays(now, 1)) return translateNow("date.tomorrow");
  if (day === addDays(now, -1)) return translateNow("date.yesterday");
  const date = dateOf(day);
  const near = day > addDays(now, -7) && day < addDays(now, 7);
  if (near) return `${new Intl.DateTimeFormat(localeNow(), { weekday: "short" }).format(date)} ${date.getDate()}`;
  const sameYear = day.slice(0, 4) === now.slice(0, 4);
  return new Intl.DateTimeFormat(localeNow(), { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

export function dayHeading(day: Day, now: Day = today()): string {
  const date = dateOf(day);
  const base =
    day < addDays(now, 7)
      ? `${new Intl.DateTimeFormat(localeNow(), { weekday: "short" }).format(date)} ${date.getDate()}`
      : new Intl.DateTimeFormat(localeNow(), { weekday: "short", month: "short", day: "numeric" }).format(date);
  return day === addDays(now, 1) ? translateNow("row.tomorrowBase", { base }) : base;
}

export function whenTone(day: Day, now: Day = today()): WhenTone {
  if (day < now) return "overdue";
  if (day === now) return "today";
  if (day === addDays(now, 1)) return "tomorrow";
  if (day < addDays(now, 7)) return "week";
  return "later";
}

export function whenLabel(day: Day | null, time: string | null, now: Day = today()): string {
  if (!day) return translateNow("date.noDate");
  return time ? `${dayName(day, now)}, ${timeLabel(time)}` : dayName(day, now);
}

function rowWhen(task: TaskData, dayShown: Day | null | undefined, now: Day): string | null {
  if (!task.dueOn) return null;
  if (dayShown && task.dueOn === dayShown) return task.dueTime ? timeLabel(task.dueTime) : null;
  return whenLabel(task.dueOn, task.dueTime, now);
}

function priorityName(priority: number | null): string {
  return priorityOptions().find((option) => option.value === String(priority ?? 4))?.label ?? translateNow("priority.low");
}

function mailState(mail: unknown): "waiting" | null {
  return mail && typeof mail === "object" ? "waiting" : null;
}

export function InlineText({ text }: { text: string }) {
  return (
    <>
      {inlinePieces(text).map((piece, index) =>
        piece.href ? (
          <a key={index} className="link inline-link" href={piece.href} target="_blank" rel="noopener noreferrer">
            <LinkedWords href={piece.href} text={piece.text} />
          </a>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </>
  );
}

function LinkedWords({ href, text }: { href: string; text: string }) {
  const [, first = text, rest = ""] = /^(\S*)([\s\S]*)$/.exec(text) ?? [];
  return (
    <>
      <span className={first.length <= 24 ? "link-lead" : undefined}>
        <LinkMark href={href} />
        {first}
      </span>
      {rest}
    </>
  );
}

export function PlaceName({ path, color }: { path: string | null; color: string | null }) {
  return (
    <span className="task-place-name" data-color={color ?? undefined}>
      {path ? <PathText path={path} /> : translateNow("filter.general")}
    </span>
  );
}

export function placeOnPage(
  task: Pick<TaskData, "nodeId" | "path">,
  showPlace: boolean,
  pageNode: string | null | undefined,
  tree: TreeNode[] | null,
): { shown: boolean; path: string | null } {
  if (!showPlace) return { shown: false, path: task.path };
  if (!pageNode) return { shown: true, path: task.path };
  if (task.nodeId === pageNode) return { shown: false, path: task.path };
  const pagePath = tree?.find((node) => node.id === pageNode)?.path;
  if (pagePath && task.path?.startsWith(`${pagePath} / `)) return { shown: true, path: task.path.slice(pagePath.length + 3) };
  return { shown: true, path: task.path };
}

export type TaskDetailRequest = {
  id: string;
  task?: Partial<TaskData> & { id: string };
  list?: Array<Partial<TaskData> & { id: string }>;
  focus?: "event";
};

const DETAIL_EVENT = "task-detail:open";

export function openTaskDetail(request: TaskDetailRequest): void {
  window.dispatchEvent(new CustomEvent<TaskDetailRequest>(DETAIL_EVENT, { detail: request }));
}

export function onOpenTaskDetail(handler: (request: TaskDetailRequest) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<TaskDetailRequest>).detail);
  window.addEventListener(DETAIL_EVENT, listener);
  return () => window.removeEventListener(DETAIL_EVENT, listener);
}

export async function readTaskItem(id: string): Promise<Item | null> {
  const answer = await tool<{ item: Item }>("get_item", { id });
  return answer.ok ? answer.item : null;
}

type Op =
  | { kind: "hide"; id: string; task?: TaskData; place?: RowPlace | null; completed: boolean; folding: boolean; gone: boolean; settled: boolean }
  | { kind: "move"; id: string; to: string; task: TaskData; at?: number; settled: boolean }
  | { kind: "patch"; id: string; patch: Partial<TaskData>; settled: boolean }
  | { kind: "order"; id: string; ids: string[]; settled: boolean };

const ops = new Map<string, Op>();
const listeners = new Set<() => void>();
let snapshot = 0;
const emit = () => {
  snapshot++;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function putOp(op: Op) {
  ops.set(`${op.kind}:${op.id}`, op);
  emit();
}
function dropOp(kind: Op["kind"], id: string) {
  if (ops.delete(`${kind}:${id}`)) emit();
}
function settleOp(kind: Op["kind"], id: string) {
  const op = ops.get(`${kind}:${id}`);
  if (op) op.settled = true;
}
function forgetSettled() {
  let changed = false;
  for (const [key, op] of ops) if (op.settled && !(op.kind === "hide" && !op.gone)) changed = ops.delete(key) || changed;
  if (changed) emit();
}

export function useTaskLanding(group: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => [...ops.values()].some((op) => op.kind === "move" && op.to === group),
    () => false,
  );
}

const LEAVE_MS = 260;
const DONE_HOLD_MS = 650;

function hideRow(id: string, hold = 0, row?: { task: TaskData; place: RowPlace | null }) {
  const op: Op = { kind: "hide", id, ...row, completed: hold > 0, folding: hold === 0, gone: false, settled: false };
  putOp(op);
  const end = () =>
    setTimeout(() => {
      if (ops.get(`hide:${id}`) !== op) return;
      op.gone = true;
      emit();
    }, LEAVE_MS);
  if (hold === 0) {
    holdPointer();
    return void end();
  }
  setTimeout(() => {
    if (ops.get(`hide:${id}`) !== op) return;
    op.folding = true;
    holdPointer();
    emit();
    end();
  }, hold);
}

function holdPointer() {
  if (typeof window === "undefined" || !window.matchMedia("(hover: hover)").matches) return;
  const root = document.documentElement;
  if (root.dataset.pointerHeld !== undefined) return;
  root.dataset.pointerHeld = "";
  let moved = 0;
  const onMove = (event: PointerEvent) => {
    moved += Math.abs(event.movementX) + Math.abs(event.movementY);
    if (moved < 6) return;
    delete root.dataset.pointerHeld;
    window.removeEventListener("pointermove", onMove);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
}

function focusAfterRow(id: string): (() => HTMLElement | null) | undefined {
  const row = document.querySelector<HTMLElement>(`[data-item="${id}"]`);
  if (!row?.contains(document.activeElement)) return undefined;
  const rows = [...document.querySelectorAll<HTMLElement>(".task[data-item]")].map((each) => each.dataset.item!);
  const at = rows.indexOf(id);
  const nearest = [id, ...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0)).reverse()];
  return () => {
    for (const each of nearest) {
      const open = document.querySelector<HTMLElement>(`[data-item="${each}"] .task-open`);
      if (!open) continue;
      if (each === id) returning = null;
      return open;
    }
    return null;
  };
}

function refocusSoon(target: () => HTMLElement | null) {
  requestAnimationFrame(() => requestAnimationFrame(() => target()?.focus({ preventScroll: true })));
}

let returning: string | null = null;
function focusWhenBack(id: string) {
  returning = id;
  const movedOn = () => {
    if (returning === id) returning = null;
  };
  window.addEventListener("keydown", movedOn, { capture: true, once: true });
  window.addEventListener("pointerdown", movedOn, { capture: true, once: true });
}

type GroupEntry = { group: string; label: string; dropDay: Day | null | undefined; element: HTMLElement };
const groups = new Map<string, GroupEntry>();

function groupsInOrder(): GroupEntry[] {
  return [...groups.values()]
    .filter((entry) => entry.element.isConnected)
    .sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

type RowPlace = { group: string; at: number };
function placeOfRow(id: string): RowPlace | null {
  const row = document.querySelector<HTMLElement>(`[data-key="${id}"]`);
  const entry = [...groups.values()].find((each) => each.element === row?.parentElement);
  if (!row || !entry) return null;
  return { group: entry.group, at: [...entry.element.querySelectorAll(":scope > [data-key]")].indexOf(row) };
}

type TaskActions = ReturnType<typeof useTaskActions>;
type Actions = TaskActions;

export function taskFromItem(item: Item, extra: Partial<TaskData> = {}): TaskData {
  return {
    id: item.id,
    title: item.title,
    description: null,
    status: item.status,
    priority: item.priority,
    dueOn: item.dueOn,
    dueTime: item.dueTime ?? null,
    nodeId: item.nodeId,
    path: item.nodePath,
    color: null,
    parentId: item.parentId,
    subtasks: { done: 0, total: 0 },
    notes: 0,
    decisions: 0,
    source: item.source,
    agentLabel: item.agentLabel,
    position: item.position ?? 0,
    createdAt: item.createdAt,
    completedAt: item.completedAt ?? null,
    ...extra,
  };
}

export function pasteLinkOver(field: HTMLInputElement | HTMLTextAreaElement, pasted: string): string | null {
  const address = pasted.trim();
  if (!/^(https?:\/\/|mailto:)\S+$/i.test(address)) return null;
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  if (end <= start) return null;
  const words = field.value.slice(start, end);
  if (!words.trim()) return null;
  return field.value.slice(0, start) + inlineLink(words, address) + field.value.slice(end);
}

export function useTaskActions() {
  const { notify, touch, saving } = useWorkspace();

  async function bringBack(task: TaskData, place: RowPlace | null, takesFocus: boolean, write: Promise<{ ok: boolean; message?: string }>) {
    if (takesFocus) focusWhenBack(task.id);
    if (place) putOp({ kind: "move", id: task.id, to: place.group, task, at: place.at, settled: false });
    dropOp("hide", task.id);
    if (await saving(write)) settleOp("move", task.id);
    else dropOp("move", task.id);
  }

  async function complete(task: TaskData): Promise<boolean> {
    const reopening = task.status === "done";
    const was = task.status;
    const title = inlinePlain(task.title);
    const focusAfter = focusAfterRow(task.id);
    const place = placeOfRow(task.id);
    hideRow(task.id, reopening ? 0 : DONE_HOLD_MS, { task, place });
    const answer = await tool("update_item", { id: task.id, status: reopening ? "open" : "done" });
    if (!answer.ok) {
      dropOp("hide", task.id);
      notify({ text: translateNow(reopening ? "row.couldNotReopened" : "row.couldNotCompleted", { title, message: answer.message }), tone: "error" });
      if (focusAfter) refocusSoon(focusAfter);
      return false;
    }
    settleOp("hide", task.id);
    touch();
    notify({
      text: reopening ? translateNow("row.reopened", { title }) : translateNow("row.completed", { title }),
      tone: "status",
      focusAfter,
      undo: () => void bringBack(task, place, Boolean(focusAfter), tool("update_item", { id: task.id, status: was })),
    });
    return true;
  }

  async function remove(task: TaskData) {
    const focusAfter = focusAfterRow(task.id);
    const place = placeOfRow(task.id);
    hideRow(task.id);
    const answer = await tool("delete_item", { id: task.id });
    if (!answer.ok) {
      dropOp("hide", task.id);
      notify({ text: translateNow("row.couldNotDelete", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
      if (focusAfter) refocusSoon(focusAfter);
      return;
    }
    settleOp("hide", task.id);
    touch();
    notify({
      text: translateNow("workspace.deletedItem", { title: inlinePlain(task.title) }),
      tone: "status",
      focusAfter,
      undo: () => void bringBack(task, place, Boolean(focusAfter), post(`/api/items/${task.id}/restore`, {})),
    });
  }

  async function patch(task: TaskData, change: Partial<TaskData>, input: Record<string, unknown>, failure: string) {
    putOp({ kind: "patch", id: task.id, patch: change, settled: false });
    const answer = await tool("update_item", { id: task.id, ...input });
    if (!answer.ok) {
      dropOp("patch", task.id);
      notify({ text: `${failure}: ${answer.message}`, tone: "error" });
      return false;
    }
    settleOp("patch", task.id);
    touch();
    return true;
  }

  const setPriority = (task: TaskData, priority: number) =>
    patch(task, { priority }, { priority }, translateNow("row.priorityNotChanged", { title: inlinePlain(task.title) }));

  async function moveToDay(task: TaskData, day: Day | null, group: string | null, label: string, at?: number) {
    if (task.dueOn === day) return;
    const moved = { ...task, dueOn: day, dueTime: day ? task.dueTime : null };
    if (group) putOp({ kind: "move", id: task.id, to: group, task: moved, at, settled: false });
    else putOp({ kind: "patch", id: task.id, patch: { dueOn: day, dueTime: moved.dueTime }, settled: false });
    const answer = await tool("update_item", { id: task.id, dueOn: day });
    const kind = group ? "move" : "patch";
    if (!answer.ok) {
      dropOp(kind, task.id);
      return notify({ text: translateNow("row.couldNotMove", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
    }
    settleOp(kind, task.id);
    touch();
    notify({
      text: translateNow("row.movedTo", { title: inlinePlain(task.title), label }),
      tone: "status",
      undo: () => void saving(tool("update_item", { id: task.id, dueOn: task.dueOn, ...(task.dueTime ? { dueTime: task.dueTime } : {}) })),
    });
  }

  async function moveToPlace(task: TaskData, node: TreeNode | null) {
    if (task.nodeId === (node?.id ?? null)) return;
    putOp({ kind: "patch", id: task.id, patch: { nodeId: node?.id ?? null, path: node?.path ?? null, color: node?.color ?? null }, settled: false });
    const answer = await tool<{ previous: { nodeId: string | null } }>("move_item", { id: task.id, node: node?.id ?? null });
    if (!answer.ok) {
      dropOp("patch", task.id);
      return notify({ text: translateNow("row.couldNotMove", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
    }
    settleOp("patch", task.id);
    touch();
    const back = answer.previous.nodeId;
    notify({
      text: translateNow("row.movedTo", { title: inlinePlain(task.title), label: node?.path ?? translateNow("filter.general") }),
      tone: "status",
      undo: () => void saving(tool("move_item", { id: task.id, node: back })),
    });
  }

  async function reorder(group: string, ids: string[]) {
    putOp({ kind: "order", id: group, ids, settled: false });
    const answer = await tool("reorder_items", { ids });
    if (!answer.ok) {
      dropOp("order", group);
      return notify({ text: translateNow("row.orderNotSaved", { message: answer.message }), tone: "error" });
    }
    settleOp("order", group);
    touch();
  }

  async function duplicate(task: TaskData) {
    const item = await readTaskItem(task.id);
    const answer = await tool<{ item: Item }>("create_task", {
      node: task.nodeId,
      ...(task.parentId ? { parent: task.parentId } : {}),
      title: task.title,
      ...(item?.body ? { notes: item.body } : {}),
      priority: task.priority ?? 4,
      ...(task.dueOn ? { dueOn: task.dueOn } : {}),
      ...(task.dueOn && task.dueTime ? { dueTime: task.dueTime } : {}),
    });
    if (!answer.ok) return notify({ text: translateNow("row.couldNotDuplicate", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
    touch();
    const copy = answer.item.id;
    notify({
      text: translateNow("row.duplicated", { title: inlinePlain(task.title) }),
      tone: "status",
      undo: () => void saving(tool("delete_item", { id: copy })),
    });
  }

  return { complete, remove, setPriority, moveToDay, moveToPlace, reorder, duplicate };
}

function dayTargets(now: Day): Array<{ label: string; day: Day | null }> {
  const weekday = dateOf(now).getDay();
  const nextMonday = addDays(now, ((8 - weekday) % 7) || 7);
  return [
    { label: translateNow("date.today"), day: now },
    { label: translateNow("date.tomorrow"), day: addDays(now, 1) },
    { label: translateNow("row.nextWeek"), day: nextMonday },
    { label: translateNow("date.noDate"), day: null },
  ];
}

function groupOfDay(day: Day | null, now: Day): string {
  if (day === null) return "noDate";
  if (day < now) return "overdue";
  if (day === now) return "today";
  return day;
}

function taskMenuEntries(task: TaskData, actions: Actions, tree: TreeNode[] | null, list?: TaskData[]): MenuEntry[] {
  const now = today();
  const places: MenuEntry[] = [
    { kind: "action", label: translateNow("filter.general"), disabled: task.nodeId === null, onSelect: () => void actions.moveToPlace(task, null) },
    ...(tree ?? []).map(
      (node): MenuEntry => ({
        kind: "action",
        label: node.path,
        disabled: node.id === task.nodeId,
        onSelect: () => void actions.moveToPlace(task, node),
      }),
    ),
  ];
  return [
    {
      kind: "choice",
      label: translateNow("quick.priority"),
      icon: PriorityIcon,
      value: String(task.priority ?? 4),
      options: priorityOptions(),
      onChoose: (value) => void actions.setPriority(task, Number(value)),
    },
    {
      kind: "submenu",
      label: translateNow("row.moveTo"),
      icon: MoveIcon,
      entries: [
        {
          kind: "group",
          label: translateNow("row.day"),
          entries: dayTargets(now).map(
            (target): MenuEntry => ({
              kind: "action",
              label: target.label,
              disabled: task.dueOn === target.day,
              onSelect: () => void actions.moveToDay(task, target.day, groupOfDay(target.day, now), target.label),
            }),
          ),
        },
        { kind: "separator" },
        { kind: "group", label: translateNow("filter.clientOrProject"), entries: places },
      ],
    },
    { kind: "action", label: translateNow("row.linkEvent"), icon: LinkIcon, onSelect: () => openTaskDetail({ id: task.id, task, list, focus: "event" }) },
    { kind: "action", label: translateNow("row.duplicate"), icon: DuplicateIcon, onSelect: () => void actions.duplicate(task) },
    { kind: "separator" },
    { kind: "action", label: translateNow("row.delete"), tone: "danger", icon: DeleteIcon, onSelect: () => void actions.remove(task) },
  ];
}

export function TaskCircle({ title, priority, done, onToggle, className }: { title: string; priority: number | null; done: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={translateNow(done ? "row.reopenNamed" : "row.completeNamed", { title: inlinePlain(title), priority: priorityName(priority) })}
      className={cx("task-circle", className)}
      data-priority={priority ?? 4}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}

type RowProps = {
  task: TaskData;
  layout?: "list" | "board";
  showPlace?: boolean;
  pageNode?: string | null;
  dayShown?: Day | null;
  list?: TaskData[];
  onKeyMove?: (event: KeyboardEvent<HTMLElement>) => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  leaving?: boolean;
};

function TaskRowView({ task, layout = "list", showPlace = true, pageNode, dayShown, list, onKeyMove, draggable, onDragStart, onDragEnd, leaving }: RowProps) {
  const { t } = useStrings();
  const { tree } = useWorkspace();
  const actions = useTaskActions();
  const now = today();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const subtasksId = useId();
  const when = rowWhen(task, dayShown, now);
  const tone = task.dueOn ? whenTone(task.dueOn, now) : null;
  const mail = mailState(task.mail);
  const plain = inlinePlain(task.title);
  const groupFor = (day: Day | null) => groupOfDay(day, now);
  const place = placeOnPage(task, showPlace, pageNode, tree);
  const hasMeta = Boolean(when || task.subtasks.total || task.priority === 1 || task.notes || task.decisions || mail || task.source !== "manual" || place.shown);

  useEffect(() => {
    if (returning !== task.id) return;
    returning = null;
    document.querySelector<HTMLElement>(`[data-item="${task.id}"] .task-open`)?.focus({ preventScroll: true });
  }, [task.id]);

  return (
    <div
      className="task"
      data-layout={layout}
      data-item={task.id}
      data-done={task.status === "done" || leaving || undefined}
      data-menu-open={menuOpen || undefined}
    >
      <button
        type="button"
        className="task-open"
        data-item-title
        aria-label={t("row.openNamed", { title: plain })}
        aria-keyshortcuts={onKeyMove ? "Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown" : undefined}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyMove}
        onClick={() => openTaskDetail({ id: task.id, task, list })}
      />
      <TaskCircle className="task-check" title={task.title} priority={task.priority} done={task.status === "done" || Boolean(leaving)} onToggle={() => void (leaving ? undefined : actions.complete(task))} />
      <p className="task-title t-value">
        <InlineText text={task.title} />
      </p>
      {task.description && <p className="task-desc t-help">{task.description}</p>}
      {hasMeta && (
        <div className="task-meta t-meta">
          {when && (
            <span className="task-when" data-when={tone ?? undefined}>
              <DatePicker
                look="chip"
                className="task-when-trigger"
                icon={task.dueTime ? TimeIcon : DateIcon}
                label={t("row.dateOf", { title: plain })}
                value={task.dueOn}
                display={when}
                onChange={(day) => void actions.moveToDay(task, day, groupFor(day), day ? dayName(day, now) : t("date.noDate"))}
              />
            </span>
          )}
          {task.subtasks.total > 0 && (
            <button
              type="button"
              className="task-subtasks-toggle"
              aria-expanded={open}
              aria-controls={subtasksId}
              aria-label={t("row.subtasksDone", { done: task.subtasks.done, total: task.subtasks.total })}
              onClick={(event) => {
                event.stopPropagation();
                setOpen((value) => !value);
              }}
            >
              <SubtasksIcon />
              {task.subtasks.done}/{task.subtasks.total}
            </button>
          )}
          {task.priority === 1 && (
            <span className="task-priority" data-priority={task.priority}>
              <PriorityIcon />
              {priorityName(task.priority)}
            </span>
          )}
          {mail && (
            <span className="task-mail" data-mail={mail}>
              <MailIcon />
              {t("row.waitingForMail")}
            </span>
          )}
          {task.notes > 0 && (
            <span className="task-notes">
              <NoteIcon />
              {countedNow(task.notes, "counted.note", "counted.notes")}
            </span>
          )}
          {task.decisions > 0 && (
            <span className="task-notes">
              <DecisionIcon />
              {countedNow(task.decisions, "counted.decision", "counted.decisions")}
            </span>
          )}
          {task.source !== "manual" && (
            <span className="task-source">
              {task.source === "agent" ? <ByAgentIcon /> : <ByChatIcon />}
              {sourceName(task.source, task.agentLabel)}
            </span>
          )}
          {place.shown && (
            <span className="task-place">
              <PlaceName path={place.path} color={task.color} />
            </span>
          )}
        </div>
      )}
      <div className="task-more">
        <Menu label={t("common.more")} about={t("board.moreFor", { name: `“${plain}”` })} entries={taskMenuEntries(task, actions, tree, list)} onOpenChange={setMenuOpen} />
      </div>
      {task.subtasks.total > 0 && (
        <Fold open={open} id={subtasksId} className="task-subtasks" lazy follow>
          <Subtasks parent={task} />
        </Fold>
      )}
    </div>
  );
}

function Subtasks({ parent }: { parent: TaskData }) {
  const { saving, version } = useWorkspace();
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void tool<{ items: Item[] }>("list_items", { parent: parent.id, type: "task", status: "all" }).then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setItems(answer.items);
        setFailed(null);
      } else setFailed(answer.message);
    });
    return () => {
      live = false;
    };
  }, [parent.id, version]);
  if (failed && !items) return <p className="inline-note" data-tone="alert">{translateNow("row.subtasksNotLoaded", { message: failed })}</p>;
  if (!items) {
    return (
      <div className="task-subtask-list" role="status" aria-busy="true" aria-label={translateNow("row.loadingSubtasks")}>
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
    );
  }
  const list = items.map((item) => ({ id: item.id, title: item.title, nodeId: item.nodeId }));
  return (
    <ul className="task-subtask-list" aria-label={translateNow("row.subtasksOf", { title: inlinePlain(parent.title) })}>
      {items.map((item) => (
        <li key={item.id} className="task-subtask" data-done={item.status === "done" || undefined}>
          <TaskCircle
            title={item.title}
            priority={item.priority}
            done={item.status === "done"}
            onToggle={() => void saving(tool("update_item", { id: item.id, status: item.status === "done" ? "open" : "done" }))}
          />
          <button type="button" className="task-subtask-title t-value" onClick={() => openTaskDetail({ id: item.id, task: { id: item.id, title: item.title, nodeId: item.nodeId }, list })}>
            {inlinePlain(item.title)}
          </button>
        </li>
      ))}
    </ul>
  );
}

type ListProps = {
  group: string;
  label: string;
  tasks: TaskData[];
  layout?: "list" | "board";
  showPlace?: boolean;
  pageNode?: string | null;
  dayShown?: Day | null;
  dropDay?: Day | null;
  reorderable?: boolean;
  empty?: ReactNode;
};

type Drag = { id: string; group: string; task: TaskData; height: number };
let dragState: Drag | null = null;
const setDragging = (value: Drag | null) => {
  dragState = value;
};
const currentDrag = () => dragState;
const GRAB = { x: 24, y: 20 };

type HeadDrop = { over: (event: DragEvent<HTMLElement>) => void; drop: (event: DragEvent<HTMLElement>) => void; leave: () => void };
type LendHead = (handlers: HeadDrop) => () => void;
const DropHead = createContext<LendHead | null>(null);

export function useDropHead() {
  const lent = useRef<HeadDrop | null>(null);
  const lend = useCallback<LendHead>((handlers) => {
    lent.current = handlers;
    return () => {
      if (lent.current === handlers) lent.current = null;
    };
  }, []);
  const head = {
    onDragOver: (event: DragEvent<HTMLElement>) => lent.current?.over(event),
    onDrop: (event: DragEvent<HTMLElement>) => lent.current?.drop(event),
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) lent.current?.leave();
    },
  };
  return { lend, head };
}

export function DropHeadScope({ lend, children }: { lend: LendHead | null; children: ReactNode }) {
  return <DropHead value={lend}>{children}</DropHead>;
}

export function TaskList({ group, label, tasks, layout = "list", showPlace = true, pageNode, dayShown, dropDay, reorderable = false, empty }: ListProps) {
  const actions = useTaskActions();
  useSyncExternalStore(subscribe, () => snapshot, () => 0);
  const list = useRef<HTMLUListElement>(null);
  const seen = useRef(tasks);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const fine = useSyncExternalStore(
    (change) => {
      const query = window.matchMedia("(hover: hover) and (pointer: fine)");
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    () => false,
  );

  useEffect(() => {
    if (seen.current === tasks) return;
    seen.current = tasks;
    forgetSettled();
  }, [tasks]);

  const order = ops.get(`order:${group}`) as Extract<Op, { kind: "order" }> | undefined;
  let shown: Array<{ task: TaskData; leaving: boolean; folding: boolean; completed?: boolean }> = [];
  for (const task of tasks) {
    const moved = ops.get(`move:${task.id}`) as Extract<Op, { kind: "move" }> | undefined;
    if (moved && moved.to !== group) continue;
    const hide = ops.get(`hide:${task.id}`) as Extract<Op, { kind: "hide" }> | undefined;
    if (hide?.gone) continue;
    const patch = ops.get(`patch:${task.id}`) as Extract<Op, { kind: "patch" }> | undefined;
    shown.push({ task: patch ? { ...task, ...patch.patch } : task, leaving: Boolean(hide), folding: Boolean(hide?.folding), completed: hide?.completed });
  }
  for (const op of ops.values()) {
    if (op.kind !== "move" || op.to !== group || tasks.some((task) => task.id === op.id)) continue;
    const hide = ops.get(`hide:${op.id}`) as Extract<Op, { kind: "hide" }> | undefined;
    if (!hide?.gone) shown.splice(op.at ?? shown.length, 0, { task: op.task, leaving: Boolean(hide), folding: Boolean(hide?.folding), completed: hide?.completed });
  }
  for (const op of ops.values()) {
    if (op.kind !== "hide" || op.gone || !op.task || op.place?.group !== group || shown.some((entry) => entry.task.id === op.id)) continue;
    shown.splice(Math.min(op.place.at, shown.length), 0, { task: op.task, leaving: true, folding: op.folding, completed: op.completed });
  }
  if (order) {
    const at = new Map(order.ids.map((id, index) => [id, index]));
    shown = [...shown].sort((a, b) => (at.get(a.task.id) ?? 1e9) - (at.get(b.task.id) ?? 1e9));
  }

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    groups.set(group, { group, label, dropDay, element });
    return () => {
      if (groups.get(group)?.element === element) groups.delete(group);
    };
  }, [group, label, dropDay]);

  useFlip(list, { items: ":scope > li", share: "tasks", arrangement: layout });

  const visible = shown.filter((entry) => !entry.leaving).map((entry) => entry.task);
  const ids = visible.map((task) => task.id);

  function reorderTo(id: string, index: number) {
    const from = ids.indexOf(id);
    if (from < 0) return false;
    const target = Math.max(0, Math.min(ids.length - 1, index));
    if (target === from) return false;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(target, 0, id);
    void actions.reorder(group, next);
    return true;
  }

  function onKeyMove(task: TaskData) {
    return (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      const step = event.key === "ArrowUp" ? -1 : 1;
      if (!event.shiftKey) {
        if (!reorderable) return setSaid(translateNow("row.keepsOrder", { title: inlinePlain(task.title), label }));
        const index = ids.indexOf(task.id) + step;
        if (reorderTo(task.id, index)) {
          setSaid(translateNow("row.nowOf", { title: inlinePlain(task.title), at: Math.max(1, Math.min(ids.length, index + 1)), total: ids.length, label }));
          refocus(task.id);
        }
        return;
      }
      const all = groupsInOrder();
      const here = all.findIndex((entry) => entry.group === group);
      for (let at = here + step; at >= 0 && at < all.length; at += step) {
        const target = all[at];
        if (target.dropDay === undefined) continue;
        void actions.moveToDay(task, target.dropDay, target.group, target.label);
        refocus(task.id);
        return;
      }
      setSaid(translateNow(step < 0 ? "row.noGroupBefore" : "row.noGroupAfter", { label }));
    };
  }

  function refocus(id: string) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-item="${id}"] .task-open`)?.focus({ preventScroll: true })),
    );
  }

  const accepts = (from: string) => (from === group ? reorderable : dropDay !== undefined);

  function indexAt(event: DragEvent<HTMLElement>): number {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(":scope > [data-key]") ?? [])].filter((row) => row.dataset.key !== currentDrag()?.id);
    const y = event.clientY;
    const at = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return at < 0 ? rows.length : at;
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    const drag = currentDrag();
    if (!drag || !accepts(drag.group)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const at = drag.group === group || reorderable ? indexAt(event) : visible.length;
    if (at !== dropAt) setDropAt(at);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    const drag = currentDrag();
    setDropAt(null);
    if (!drag || !accepts(drag.group)) return;
    event.preventDefault();
    landFrom(drag.id, { x: event.clientX - GRAB.x, y: event.clientY - GRAB.y, w: 0, h: drag.height });
    list.current?.querySelector<HTMLElement>(":scope > .task-drop-mark")?.setAttribute("data-flip-exit", "none");
    if (drag.group === group) {
      const carried = list.current?.querySelector<HTMLElement>(`:scope > [data-key="${CSS.escape(drag.id)}"]`);
      if (carried) {
        carried.setAttribute("data-dropped", "");
        carried.removeAttribute("data-dragging");
        requestAnimationFrame(() => requestAnimationFrame(() => carried.removeAttribute("data-dropped")));
      }
      const without = ids.filter((id) => id !== drag.id);
      const at = indexAt(event);
      reorderTo(drag.id, Math.min(at, without.length));
    } else if (dropDay !== undefined) {
      void actions.moveToDay(drag.task, dropDay, group, label, reorderable && dropAt !== null ? dropAt : undefined);
    }
    setDragging(null);
  }

  const lendHead = useContext(DropHead);
  useEffect(() => lendHead?.({ over: onDragOver, drop: onDrop, leave: () => setDropAt(null) }));

  const carried = currentDrag();
  const mark = (
    <li key="drop-mark" data-flip-key="drop-mark" className="task-drop-mark" aria-hidden="true" style={{ "--drop-room": `${carried?.height ?? 0}px` } as CSSProperties} />
  );
  let markBefore: string | null | undefined;
  if (dropAt !== null) {
    const others = shown.filter((entry) => entry.task.id !== carried?.id);
    markBefore = others[dropAt]?.task.id ?? null;
  }

  const rows = shown.flatMap(({ task, leaving, folding, completed }) => [
    ...(markBefore === task.id ? [mark] : []),
    <li key={task.id} data-key={task.id} className="task-item" data-leaving={folding || undefined} data-completing={(leaving && completed) || undefined}>
      <TaskRowView
        task={task}
        layout={layout}
        showPlace={showPlace}
        pageNode={pageNode}
        dayShown={dayShown}
        list={visible}
        leaving={leaving}
        onKeyMove={onKeyMove(task)}
        draggable={fine && !leaving}
        onDragStart={(event) => {
          const row = (event.currentTarget as HTMLElement).closest<HTMLElement>(".task");
          const item = row?.parentElement ?? null;
          setDragging({ id: task.id, group, task, height: item?.offsetHeight ?? 0 });
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", inlinePlain(task.title));
          row?.setAttribute("data-lifted", "");
          if (row) event.dataTransfer.setDragImage(row, GRAB.x, GRAB.y);
          requestAnimationFrame(() => {
            row?.removeAttribute("data-lifted");
            item?.setAttribute("data-dragging", "");
          });
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropAt(null);
          list.current?.querySelectorAll("[data-dragging]").forEach((node) => node.removeAttribute("data-dragging"));
        }}
      />
    </li>,
  ]);
  if (markBefore === null) rows.push(mark);

  return (
    <div
      className="task-group-body"
      data-layout={layout}
      data-drop={dropAt !== null || undefined}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null);
      }}
      onDrop={onDrop}
    >
      <ul ref={list} className="task-list" data-layout={layout} aria-label={`${label}, ${countedNow(visible.length, "counted.task", "counted.tasks")}`}>
        {rows}
      </ul>
      {visible.length === 0 && dropAt === null && empty}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
