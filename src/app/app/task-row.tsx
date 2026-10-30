"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { count } from "@/lib/count";
import { addDays, LOCALE, today, type Day } from "@/lib/dates";
import { inlineLink, inlinePieces, inlinePlain } from "@/lib/inline-links";
import type { TaskRow } from "@/lib/tools/tasks";
import { cx } from "@/lib/utils";
import { post, tool, type Item, type TreeNode } from "./client-api";
import { PathText, PRIORITIES, sourceName } from "./item-parts";
import { useWorkspace } from "./workspace";
import "../styles/task.css";

// A task as `get_tasks` gives it; a row built from an item (the detail, a duplicate) may lack its mail.
export type TaskData = Omit<TaskRow, "mail"> & { mail?: TaskRow["mail"] };

// ---- Words a task is shown with ------------------------------------------------------------------------------------

export type WhenTone = "overdue" | "today" | "tomorrow" | "week" | "later";

const dateOf = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// "16:00" as the person's clock reads it: "4:00 PM".
export function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

// Where a day stands against today, and its name: «Yesterday», «Today», «Tomorrow», «Mon 26» within a week either way,
// «Nov 12» further, with the year when it is not this one's.
export function dayName(day: Day, now: Day = today()): string {
  if (day === now) return "Today";
  if (day === addDays(now, 1)) return "Tomorrow";
  if (day === addDays(now, -1)) return "Yesterday";
  const date = dateOf(day);
  const near = day > addDays(now, -7) && day < addDays(now, 7);
  if (near) return `${new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(date)} ${date.getDate()}`;
  const sameYear = day.slice(0, 4) === now.slice(0, 4);
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

// A day's heading in Upcoming: «Thu 29 · Tomorrow», «Fri 30», and «Nov 12» further than a week.
export function dayHeading(day: Day, now: Day = today()): string {
  const date = dateOf(day);
  const base =
    day < addDays(now, 7)
      ? `${new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(date)} ${date.getDate()}`
      : new Intl.DateTimeFormat(LOCALE, { weekday: "short", month: "short", day: "numeric" }).format(date);
  return day === addDays(now, 1) ? `${base} · Tomorrow` : base;
}

export function whenTone(day: Day, now: Day = today()): WhenTone {
  if (day < now) return "overdue";
  if (day === now) return "today";
  if (day === addDays(now, 1)) return "tomorrow";
  if (day < addDays(now, 7)) return "week";
  return "later";
}

// The day with its hour, as a chip or an attribute says it: «Tomorrow, 4:00 PM».
export function whenLabel(day: Day | null, time: string | null, now: Day = today()): string {
  if (!day) return "No date";
  return time ? `${dayName(day, now)}, ${timeLabel(time)}` : dayName(day, now);
}

// What a row says of its date: nothing the group's heading already says. In Today an hour alone; under its own day an
// hour alone; elsewhere the day, with its hour.
function rowWhen(task: TaskData, dayShown: Day | null | undefined, now: Day): string | null {
  if (!task.dueOn) return null;
  if (dayShown && task.dueOn === dayShown) return task.dueTime ? timeLabel(task.dueTime) : null;
  return whenLabel(task.dueOn, task.dueTime, now);
}

export function priorityName(priority: number | null): string {
  return PRIORITIES.find((option) => option.value === String(priority ?? 4))?.label ?? "Low";
}

// The mail a task waits for (`taskMailSchema`): still waiting, or a message arrived —whether it did what the task waits
// for or not, which its detail says—. A task that waits for none says nothing.
export function mailState(mail: unknown): "waiting" | "arrived" | null {
  if (!mail || typeof mail !== "object") return null;
  const status = (mail as { status?: unknown }).status;
  if (status === "waiting") return "waiting";
  if (status === "met" || status === "not_met") return "arrived";
  return null;
}

// A text that may carry links over its words: the words read as text and the link opens in a new tab.
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {inlinePieces(text).map((piece, index) =>
        piece.href ? (
          <a key={index} className="link inline-link" href={piece.href} target="_blank" rel="noopener noreferrer">
            {piece.text}
          </a>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </>
  );
}

// Where a task lives: its path with its place's color, or General.
export function PlaceName({ path, color }: { path: string | null; color: string | null }) {
  return (
    <span className="task-place-name" data-color={color ?? undefined}>
      {path ? <PathText path={path} /> : "General"}
    </span>
  );
}

// What a row says of its place on a page: nothing for a task of the page's own node, the path below that node for one
// that lives deeper, and the whole path (or General) anywhere else.
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

// ---- Opening a task's detail from anywhere ---------------------------------------------------------------------------

export type TaskDetailRequest = {
  id: string;
  // What the row already knows, so the detail paints at once.
  task?: Partial<TaskData> & { id: string };
  // The list it came from, for «Previous» and «Next».
  list?: Array<Partial<TaskData> & { id: string }>;
  // A field to land on: the event, from a row's «Link to an event…».
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

// A task as the tool layer holds it, its whole text included, read by its id (`get_item`): wherever it lives, so a
// caller that does not know its place (the palette) opens it too.
export async function readTaskItem(id: string): Promise<Item | null> {
  const answer = await tool<{ item: Item }>("get_item", { id });
  return answer.ok ? answer.item : null;
}

// ---- What shows before the server answers ----------------------------------------------------------------------------
// A change shows at once and rolls back, saying so, if the server refuses it. Each pending change is kept here until the
// view reads its data again after the server confirmed it.

type Op =
  | { kind: "hide"; id: string; gone: boolean; settled: boolean }
  | { kind: "move"; id: string; to: string; task: TaskData; settled: boolean }
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
// The view read again: what the server already confirmed is in its data now.
function forgetSettled() {
  let changed = false;
  for (const [key, op] of ops) if (op.settled) changed = ops.delete(key) || changed;
  if (changed) emit();
}

const LEAVE_MS = 260;

// A row that leaves folds away first; once its fold ends the list stops drawing it.
function hideRow(id: string) {
  const op: Op = { kind: "hide", id, gone: false, settled: false };
  putOp(op);
  setTimeout(() => {
    if (ops.get(`hide:${id}`) !== op) return;
    op.gone = true;
    emit();
  }, LEAVE_MS);
}

// ---- The groups on screen, for moving a task to the next one with the keyboard ------------------------------------

type GroupEntry = { group: string; label: string; dropDay: Day | null | undefined; element: HTMLElement };
const groups = new Map<string, GroupEntry>();

function groupsInOrder(): GroupEntry[] {
  return [...groups.values()]
    .filter((entry) => entry.element.isConnected)
    .sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

// ---- Writes a row makes --------------------------------------------------------------------------------------------

export type TaskActions = ReturnType<typeof useTaskActions>;
type Actions = TaskActions;

// A task as a row reads it, from the item the tool layer returns: what the detail hands to the same writes a row makes.
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
    source: item.source,
    agentLabel: item.agentLabel,
    position: item.position ?? 0,
    createdAt: item.createdAt,
    completedAt: item.completedAt ?? null,
    ...extra,
  };
}

// A link pasted over selected words stays on those words: `[words](address)`.
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

  // The circle completes an open task and reopens a done one; what it says and what its «Undo» does follow the way it
  // went. It answers whether the server took it, so the detail can put back what it showed.
  async function complete(task: TaskData): Promise<boolean> {
    const reopening = task.status === "done";
    const was = task.status;
    const title = inlinePlain(task.title);
    hideRow(task.id);
    const answer = await tool("update_item", { id: task.id, status: reopening ? "open" : "done" });
    if (!answer.ok) {
      dropOp("hide", task.id);
      notify({ text: `“${title}” could not be ${reopening ? "reopened" : "completed"}: ${answer.message}`, tone: "error" });
      return false;
    }
    settleOp("hide", task.id);
    touch();
    notify({
      text: reopening ? `Reopened “${title}”` : `Completed “${title}”`,
      tone: "status",
      undo: () => {
        dropOp("hide", task.id);
        void saving(tool("update_item", { id: task.id, status: was }));
      },
    });
    return true;
  }

  async function remove(task: TaskData) {
    hideRow(task.id);
    const answer = await tool("delete_item", { id: task.id });
    if (!answer.ok) {
      dropOp("hide", task.id);
      return notify({ text: `“${inlinePlain(task.title)}” could not be deleted: ${answer.message}`, tone: "error" });
    }
    settleOp("hide", task.id);
    touch();
    notify({
      text: `Deleted “${inlinePlain(task.title)}”`,
      tone: "status",
      undo: () => {
        dropOp("hide", task.id);
        void saving(post(`/api/items/${task.id}/restore`, {}));
      },
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
    patch(task, { priority }, { priority }, `The priority of “${inlinePlain(task.title)}” could not be changed`);

  // A new day moves the task to that day's group; the hour stays with a day and goes with «No date».
  async function moveToDay(task: TaskData, day: Day | null, group: string | null, label: string) {
    if (task.dueOn === day) return;
    const moved = { ...task, dueOn: day, dueTime: day ? task.dueTime : null };
    if (group) putOp({ kind: "move", id: task.id, to: group, task: moved, settled: false });
    else putOp({ kind: "patch", id: task.id, patch: { dueOn: day, dueTime: moved.dueTime }, settled: false });
    const answer = await tool("update_item", { id: task.id, dueOn: day });
    const kind = group ? "move" : "patch";
    if (!answer.ok) {
      dropOp(kind, task.id);
      return notify({ text: `“${inlinePlain(task.title)}” could not be moved: ${answer.message}`, tone: "error" });
    }
    settleOp(kind, task.id);
    touch();
    notify({
      text: `Moved “${inlinePlain(task.title)}” to ${label}`,
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
      return notify({ text: `“${inlinePlain(task.title)}” could not be moved: ${answer.message}`, tone: "error" });
    }
    settleOp("patch", task.id);
    touch();
    const back = answer.previous.nodeId;
    notify({
      text: `Moved “${inlinePlain(task.title)}” to ${node?.path ?? "General"}`,
      tone: "status",
      undo: () => void saving(tool("move_item", { id: task.id, node: back })),
    });
  }

  async function reorder(group: string, ids: string[]) {
    putOp({ kind: "order", id: group, ids, settled: false });
    const answer = await tool("reorder_items", { ids });
    if (!answer.ok) {
      dropOp("order", group);
      return notify({ text: `The new order could not be saved: ${answer.message}`, tone: "error" });
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
    if (!answer.ok) return notify({ text: `“${inlinePlain(task.title)}” could not be duplicated: ${answer.message}`, tone: "error" });
    touch();
    const copy = answer.item.id;
    notify({
      text: `Duplicated “${inlinePlain(task.title)}”`,
      tone: "status",
      undo: () => void saving(tool("delete_item", { id: copy })),
    });
  }

  return { complete, remove, setPriority, moveToDay, moveToPlace, reorder, duplicate };
}

// The days «Move to…» offers, from the person's day.
function dayTargets(now: Day): Array<{ label: string; day: Day | null }> {
  const weekday = dateOf(now).getDay();
  const nextMonday = addDays(now, ((8 - weekday) % 7) || 7);
  return [
    { label: "Today", day: now },
    { label: "Tomorrow", day: addDays(now, 1) },
    { label: "Next week", day: nextMonday },
    { label: "No date", day: null },
  ];
}

function groupOfDay(day: Day | null, now: Day): string {
  if (day === null) return "noDate";
  if (day < now) return "overdue";
  if (day === now) return "today";
  return day;
}

// The entries every task's «More» carries, in this order: Priority, Move to…, Link to an event…, Duplicate, Delete.
export function taskMenuEntries(task: TaskData, actions: Actions, tree: TreeNode[] | null, list?: TaskData[]): MenuEntry[] {
  const now = today();
  const places: MenuEntry[] = [
    { kind: "action", label: "General", disabled: task.nodeId === null, onSelect: () => void actions.moveToPlace(task, null) },
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
      label: "Priority",
      value: String(task.priority ?? 4),
      options: PRIORITIES.map((option) => ({ value: option.value, label: option.label })),
      onChoose: (value) => void actions.setPriority(task, Number(value)),
    },
    {
      kind: "submenu",
      label: "Move to…",
      entries: [
        {
          kind: "group",
          label: "Day",
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
        { kind: "group", label: "Place", entries: places },
      ],
    },
    { kind: "action", label: "Link to an event…", onSelect: () => openTaskDetail({ id: task.id, task, list, focus: "event" }) },
    { kind: "action", label: "Duplicate", onSelect: () => void actions.duplicate(task) },
    { kind: "separator" },
    { kind: "action", label: "Delete", tone: "danger", onSelect: () => void actions.remove(task) },
  ];
}

// ---- The circle that completes a task ----------------------------------------------------------------------------------

export function TaskCircle({ title, priority, done, onToggle, className }: { title: string; priority: number | null; done: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      // The circle's color is one of the two only marks of its priority: its name says the priority in words, so Normal
      // and Low read alike to whoever does not see the color.
      aria-label={`${done ? `Mark “${inlinePlain(title)}” open` : `Complete “${inlinePlain(title)}”`}, ${priorityName(priority)} priority`}
      className={cx("task-circle", className)}
      data-priority={priority ?? 4}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}

// ---- One task: its row in a list, or its card on a board ------------------------------------------------------------

type RowProps = {
  task: TaskData;
  layout?: "list" | "board";
  // Inside its own page the place goes without saying.
  showPlace?: boolean;
  // The node whose page shows the row: a task of that node says no place, and one below it says only the path under it
  // («Ordering flow» inside Website).
  pageNode?: string | null;
  // The day the group's heading already names: the row does not repeat it.
  dayShown?: Day | null;
  // The list it lives in, for the detail's «Previous» and «Next».
  list?: TaskData[];
  // The group it lives in: where a new date moves it.
  onKeyMove?: (event: KeyboardEvent<HTMLElement>) => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  leaving?: boolean;
};

export function TaskRowView({ task, layout = "list", showPlace = true, pageNode, dayShown, list, onKeyMove, draggable, onDragStart, onDragEnd, leaving }: RowProps) {
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
  const hasMeta = Boolean(when || task.subtasks.total || task.priority === 1 || task.priority === 2 || task.notes || mail || task.source !== "manual");
  const groupFor = (day: Day | null) => groupOfDay(day, now);
  const place = placeOnPage(task, showPlace, pageNode, tree);

  return (
    <div
      className="task"
      data-layout={layout}
      data-item={task.id}
      data-done={task.status === "done" || leaving || undefined}
      data-menu-open={menuOpen || undefined}
      data-place={place.shown || undefined}
    >
      <button
        type="button"
        className="task-open"
        data-item-title
        aria-label={`Open “${plain}”`}
        aria-keyshortcuts={onKeyMove ? "Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown" : undefined}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyMove}
        onClick={() => openTaskDetail({ id: task.id, task, list })}
      />
      <TaskCircle className="task-check" title={task.title} priority={task.priority} done={task.status === "done" || Boolean(leaving)} onToggle={() => void actions.complete(task)} />
      <p className="task-title t-value">
        <InlineText text={task.title} />
      </p>
      {place.shown && (
        <p className="task-place t-meta">
          <PlaceName path={place.path} color={task.color} />
        </p>
      )}
      {task.description && <p className="task-desc t-help">{task.description}</p>}
      {(hasMeta || layout === "list") && (
        <div className="task-meta t-meta">
          {when && (
            <span className="task-when" data-when={tone ?? undefined}>
              <DatePicker
                look="chip"
                className="task-when-trigger"
                label={`Date of “${plain}”`}
                value={task.dueOn}
                display={when}
                onChange={(day) => void actions.moveToDay(task, day, groupFor(day), day ? dayName(day, now) : "No date")}
              />
            </span>
          )}
          {task.subtasks.total > 0 && (
            <button
              type="button"
              className="task-subtasks-toggle"
              aria-expanded={open}
              aria-controls={subtasksId}
              aria-label={`${task.subtasks.done}/${task.subtasks.total} subtasks done`}
              onClick={(event) => {
                event.stopPropagation();
                setOpen((value) => !value);
              }}
            >
              {task.subtasks.done}/{task.subtasks.total}
            </button>
          )}
          {(task.priority === 1 || task.priority === 2) && (
            <span className="task-priority" data-priority={task.priority}>
              {priorityName(task.priority)}
            </span>
          )}
          {task.notes > 0 && <span className="task-notes">{count(task.notes, "note", "notes")}</span>}
          {mail && (
            <span className="task-mail" data-mail={mail}>
              {mail === "arrived" ? "Mail arrived" : "Waiting for mail"}
            </span>
          )}
          {task.source !== "manual" && <span className="task-source">{sourceName(task.source, task.agentLabel)}</span>}
        </div>
      )}
      <div className="task-more">
        <Menu label="More" about={`for “${plain}”`} entries={taskMenuEntries(task, actions, tree, list)} onOpenChange={setMenuOpen} />
      </div>
      {task.subtasks.total > 0 && (
        <div className="fold task-subtasks" id={subtasksId} data-open={open}>
          <div>{open && <Subtasks parent={task} />}</div>
        </div>
      )}
    </div>
  );
}

// A task's subtasks, unfolded inside its row: each completes in place and opens its own detail.
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
  if (failed && !items) return <p className="inline-note" data-tone="alert">The subtasks could not be read: {failed}</p>;
  if (!items) {
    return (
      <div className="task-subtask-list" role="status" aria-busy="true" aria-label="Reading the subtasks">
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
    );
  }
  const list = items.map((item) => ({ id: item.id, title: item.title, nodeId: item.nodeId }));
  return (
    <ul className="task-subtask-list" aria-label={`Subtasks of “${inlinePlain(parent.title)}”`}>
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

// ---- A group's list: rows that travel when they reorder, dragged or moved with the keyboard -------------------------

type ListProps = {
  // The group's key —"overdue", "today", a day, "noDate"— and its name, which an announcement says.
  group: string;
  label: string;
  tasks: TaskData[];
  layout?: "list" | "board";
  showPlace?: boolean;
  // The node whose page shows the list: each row says its place relative to it (`TaskRowView`'s `pageNode`).
  pageNode?: string | null;
  dayShown?: Day | null;
  // What a task dropped here takes as its day; undefined when nothing is dropped here (Overdue).
  dropDay?: Day | null;
  // The group keeps the person's own order: a drag inside it reorders.
  reorderable?: boolean;
  // Shown when the group holds nothing: its own words, with its own button.
  empty?: ReactNode;
};

type Drag = { id: string; group: string; task: TaskData };
let dragState: Drag | null = null;
const setDragging = (value: Drag | null) => {
  dragState = value;
};
const currentDrag = () => dragState;

export function TaskList({ group, label, tasks, layout = "list", showPlace = true, pageNode, dayShown, dropDay, reorderable = false, empty }: ListProps) {
  const actions = useTaskActions();
  // Every pending change redraws the list.
  useSyncExternalStore(subscribe, () => snapshot, () => 0);
  const list = useRef<HTMLUListElement>(null);
  const last = useRef(new Map<string, number>());
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

  // New data from the server: what it already confirmed is in it now.
  useEffect(() => {
    if (seen.current === tasks) return;
    seen.current = tasks;
    forgetSettled();
  }, [tasks]);

  // What the view shows: the data, minus what left, plus what was moved here, in the order being saved.
  const order = ops.get(`order:${group}`) as Extract<Op, { kind: "order" }> | undefined;
  let shown: Array<{ task: TaskData; leaving: boolean }> = [];
  for (const task of tasks) {
    const moved = ops.get(`move:${task.id}`) as Extract<Op, { kind: "move" }> | undefined;
    if (moved && moved.to !== group) continue;
    const hide = ops.get(`hide:${task.id}`) as Extract<Op, { kind: "hide" }> | undefined;
    if (hide?.gone) continue;
    const patch = ops.get(`patch:${task.id}`) as Extract<Op, { kind: "patch" }> | undefined;
    shown.push({ task: patch ? { ...task, ...patch.patch } : task, leaving: Boolean(hide) });
  }
  for (const op of ops.values()) {
    if (op.kind === "move" && op.to === group && !tasks.some((task) => task.id === op.id)) shown.push({ task: op.task, leaving: false });
  }
  if (order) {
    const at = new Map(order.ids.map((id, index) => [id, index]));
    shown = [...shown].sort((a, b) => (at.get(a.task.id) ?? 1e9) - (at.get(b.task.id) ?? 1e9));
  }

  // This group is on screen: the keyboard can move a task to it.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    groups.set(group, { group, label, dropDay, element });
    return () => {
      if (groups.get(group)?.element === element) groups.delete(group);
    };
  }, [group, label, dropDay]);

  // A redrawn list travels: what moved goes from its old place to the new one, and what arrives enters.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = element.getBoundingClientRect();
    const next = new Map<string, number>();
    const first = last.current.size === 0;
    element.querySelectorAll<HTMLElement>(":scope > [data-key]").forEach((node) => {
      const key = node.dataset.key!;
      const top = node.getBoundingClientRect().top - origin.top;
      next.set(key, top);
      if (reduced || first) return;
      const before = last.current.get(key);
      if (before === undefined) {
        node.animate([{ opacity: 0.001, translate: "0 0.4rem" }, { opacity: 1, translate: "0 0" }], { duration: 280, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" });
      } else if (Math.abs(before - top) > 1) {
        node.animate([{ translate: `0 ${before - top}px` }, { translate: "0 0" }], { duration: 300, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
      }
    });
    last.current = next;
  });

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

  // Alt with the arrows reorders the focused task in its group; with Shift too it goes to the group before or after.
  function onKeyMove(task: TaskData) {
    return (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      const step = event.key === "ArrowUp" ? -1 : 1;
      if (!event.shiftKey) {
        if (!reorderable) return setSaid(`“${inlinePlain(task.title)}” keeps the group's order: ${label} is sorted by date.`);
        const index = ids.indexOf(task.id) + step;
        if (reorderTo(task.id, index)) {
          setSaid(`“${inlinePlain(task.title)}” is now ${Math.max(1, Math.min(ids.length, index + 1))} of ${ids.length} in ${label}.`);
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
      setSaid(`No group ${step < 0 ? "before" : "after"} ${label} takes a task.`);
    };
  }

  // The moved task keeps the focus wherever it lands.
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
    if (drag.group === group) {
      const without = ids.filter((id) => id !== drag.id);
      const at = indexAt(event);
      reorderTo(drag.id, Math.min(at, without.length));
    } else if (dropDay !== undefined) {
      void actions.moveToDay(drag.task, dropDay, group, label);
    }
    setDragging(null);
  }

  // Where a drop lands shows as a mark between the rows, counted among the rows that are not the one dragged.
  const mark = <li key="drop-mark" className="task-drop-mark" aria-hidden="true" />;
  let markBefore: string | null | undefined;
  if (dropAt !== null) {
    const dragged = currentDrag()?.id;
    const others = shown.filter((entry) => entry.task.id !== dragged);
    markBefore = others[dropAt]?.task.id ?? null;
  }

  const rows = shown.flatMap(({ task, leaving }) => [
    ...(markBefore === task.id ? [mark] : []),
    <li key={task.id} data-key={task.id} className="task-item" data-leaving={leaving || undefined}>
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
          setDragging({ id: task.id, group, task });
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", inlinePlain(task.title));
          const row = (event.currentTarget as HTMLElement).closest<HTMLElement>(".task");
          if (row) event.dataTransfer.setDragImage(row, 24, 20);
          requestAnimationFrame(() => (event.target as HTMLElement).closest("li")?.setAttribute("data-dragging", ""));
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
      <ul ref={list} className="task-list" data-layout={layout} data-place={showPlace || undefined} aria-label={`${label}, ${count(visible.length, "task", "tasks")}`}>
        {rows}
      </ul>
      {visible.length === 0 && dropAt === null && empty}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
