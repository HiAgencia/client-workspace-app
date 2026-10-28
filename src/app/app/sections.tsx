"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { addDays, instantsOf, LOCALE, longDay, monthOf, rangeLabel, weekOf, type Day } from "@/lib/dates";
import { Agenda, Empty } from "./blocks";
import { tool, type Board, type CalendarEvent, type EventsFailure, type Item, type TreeNode } from "./client-api";
import { plainClick, requestFocus } from "./focus-request";
import { PathText, PRIORITIES, sourceName, TYPE_NAMES } from "./item-parts";
import { ItemList, ItemRow, QuickAdd } from "./items";
import { useWorkspace } from "./workspace";

// The board's sections: each one reads its own data, carries its own filters in its head, and keeps them in the
// address, so a reload, back, and a pasted link return to the same board. Overview, a client and a project compose them.

export type Range = "today" | "week" | "month" | "all";
type AgendaRange = Exclude<Range, "all">;
type Source = Item["source"];

// One name per range wherever it appears, at every width: the section's meta says the exact days.
const RANGES: Array<{ value: Range; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "Any date" },
];
const AGENDA_RANGES = RANGES.filter((range): range is { value: AgendaRange; label: string } => range.value !== "all");
const STATUS = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
] as const;
const WHO: Source[] = ["manual", "chat", "agent"];
const WHAT: Array<Item["type"]> = ["task", "note", "decision", "link", "review"];
const KINDS = [
  { value: "all", label: "All" },
  { value: "client", label: "Clients" },
  { value: "project", label: "Projects" },
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The board's state, read from the address through an allowlist: an unknown value is dropped, never applied as nothing.
// The Overview opens its tasks on today; a client's or a project's page on every date.
export function useBoardState(defaultTasks: Range = "today") {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo(() => {
    const one = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(params.get(key) ?? "") ? (params.get(key) as T) : fallback;
    const list = <T extends string>(key: string, allowed: readonly T[]): T[] =>
      (params.get(key) ?? "").split(",").filter((value): value is T => (allowed as readonly string[]).includes(value));
    const scope = params.get("scope");
    return {
      scope: scope && UUID.test(scope) ? scope : null,
      tasks: one<Range>("tasks", ["today", "week", "month", "all"], defaultTasks),
      status: one<"open" | "done">("status", ["open", "done"], "open"),
      priority: list<string>("priority", ["1", "2", "3", "4"]),
      agenda: one<AgendaRange>("agenda", ["today", "week", "month"], "week"),
      review: one<"open" | "done">("review", ["open", "done"], "open"),
      who: list<Source>("who", ["manual", "chat", "agent"]),
      what: list<Item["type"]>("what", WHAT),
      kind: one<"all" | "client" | "project">("kind", ["all", "client", "project"], "all"),
    };
  }, [params, defaultTasks]);
  const set = useCallback(
    (change: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(change)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return { state, set, query: params.toString(), defaultTasks };
}

export type BoardState = ReturnType<typeof useBoardState>["state"];
export type SetBoard = ReturnType<typeof useBoardState>["set"];

export function rangeOf(range: Range, now: Day, weekStart: number): { from: Day; to: Day } | null {
  if (range === "today") return { from: now, to: now };
  if (range === "week") return weekOf(now, weekStart);
  if (range === "month") return monthOf(now);
  return null;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${noun(count, one, many)}`;
}

function noun(count: number, one: string, many: string): string {
  return new Intl.PluralRules("en").select(count) === "one" ? one : many;
}

// What a section read, with the request it answers: once the request changes —another scope, another filter— what is
// on screen belongs to the previous one and says so until the new answer arrives.
export type Read<T> = { key: string; value: T };

// A page that enters whole can hand a section its first read (`initial`), so the section paints with it instead of a
// placeholder that grows and pushes what is below.
export function useRead<T>(name: string, input: Record<string, unknown>, initial: Read<T> | null = null): { data: T | null; error: string | null; stale: boolean } {
  const { version } = useWorkspace();
  const key = JSON.stringify(input);
  const [read, setRead] = useState<Read<T> | null>(initial);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  // The read handed in is the first one: it is not asked again on mounting.
  const handed = useRef(initial?.key ?? null);
  useEffect(() => {
    if (handed.current === key) {
      handed.current = null;
      return;
    }
    handed.current = null;
    let live = true;
    void tool<T>(name, JSON.parse(key)).then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setRead({ key, value: answer });
        setError(null);
      } else setError({ key, message: answer.message });
    });
    return () => {
      live = false;
    };
  }, [name, key, version]);
  return { data: read?.value ?? null, error: error?.key === key ? error.message : null, stale: read !== null && read.key !== key };
}

// A section's head: its title and count on the left, its own filters beside them; the title names what the section
// shows, the count says how many of it.
export function SectionHead({ id, title, meta, children }: { id: string; title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="section-title">
        {/* A figure or a link that takes the view here hands the focus to the title. */}
        <h2 id={id} className="t-title" tabIndex={-1}>
          {title}
        </h2>
        {meta !== undefined && <span className="t-meta">{meta}</span>}
      </div>
      {children && <div className="section-filters">{children}</div>}
    </div>
  );
}

function Chip({ pressed, count, onClick, children, data }: { pressed: boolean; count?: number; onClick: () => void; children: string; data: string }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick} data-filter={data}>
      <span>{children}</span>
      {count !== undefined && (
        <span className="chip-count" aria-label={plural(count, "task", "tasks")}>
          {count}
        </span>
      )}
    </button>
  );
}

const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]).join(",") || null;

function SectionSkeleton({ label }: { label: string }) {
  return (
    <div className="stack" role="status" aria-label={label} aria-busy="true">
      {["70%", "55%", "62%"].map((width) => (
        <span key={width} className="skeleton" style={{ width }} />
      ))}
    </div>
  );
}

// ---- The figures: each counts the whole universe of the scope and takes the view to the section it filters. ---------

export type FigureKey = "late" | "today" | "week" | "review" | "events";
// The events of today as the agenda read them: whole, with some calendars missing, or not at all.
export type EventsToday = { count: number; complete: boolean } | "failed" | null;

export function Figures({
  board,
  failed,
  week,
  events,
  onPick,
}: {
  board: Board | null;
  failed: string | null;
  week: { from: Day; to: Day };
  events: EventsToday;
  onPick: (target: FigureKey) => void;
}) {
  const figures = board?.figures;
  // Not read yet is a placeholder; not readable is a dash with its reason, never a zero that reads as a count.
  const read = (value: number | undefined): number | "failed" | null => (value !== undefined ? value : failed ? "failed" : null);
  const tiles: Array<{ key: FigureKey; value: number | "failed" | null; one: string; many: string; help: string; alert?: boolean; helpAlert?: boolean }> = [
    { key: "late", value: read(figures?.late), one: "late task", many: "late tasks", help: "Past their due date", alert: (figures?.late ?? 0) > 0 },
    { key: "today", value: read(figures?.dueToday), one: "task due today", many: "tasks due today", help: "Before the day ends" },
    { key: "week", value: read(figures?.dueInRange), one: "task due this week", many: "tasks due this week", help: rangeLabel(week.from, week.to) },
    { key: "review", value: read(figures?.toReview), one: "item to review", many: "items to review", help: "Waiting for a look" },
    {
      key: "events",
      value: events === "failed" ? "failed" : (events?.count ?? null),
      one: "event today",
      many: "events today",
      help: events === "failed" ? "The calendars could not be read" : events && !events.complete ? "Some calendars could not be read" : "From the calendars in view",
      helpAlert: events === "failed" || (events !== null && !events.complete),
    },
  ];
  return (
    <section className="figures" aria-label="Figures" data-figures aria-busy={(board === null && !failed) || undefined}>
      {failed && (
        <p role="alert" className="inline-note figures-note" data-tone="alert">
          The figures could not be read: {failed}.
        </p>
      )}
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          className="figure"
          data-figure={tile.key}
          data-tone={tile.alert ? "alert" : undefined}
          onClick={() => onPick(tile.key)}
          disabled={typeof tile.value !== "number"}
        >
          {tile.value === null ? (
            <span className="skeleton skeleton-title figure-wait" aria-label="Reading" />
          ) : tile.value === "failed" ? (
            <span className="figure-value" aria-label="Not read">
              —
            </span>
          ) : (
            <span className="figure-value">{tile.value}</span>
          )}
          <span className="figure-text">
            <span className="figure-label t-label">{typeof tile.value === "number" ? noun(tile.value, tile.one, tile.many) : tile.many}</span>
            <span className="t-meta" data-tone={tile.helpAlert ? "alert" : undefined}>
              {tile.help}
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}

// ---- Tasks: late and due today, a week, a month, or any date; by priority; open or done. -----------------------------

export type Browse = { items: Item[]; total: number; counts: { priority: Record<string, number>; date: { overdue: number; dated: number; undated: number } } };

// What the Tasks section asks for, from one place: a page that reads it ahead hands the section the same request.
export function tasksInput(scope: string | null, state: BoardState, now: Day, weekStart: number): Record<string, unknown> {
  const range = rangeOf(state.tasks, now, weekStart);
  return {
    ...(scope ? { node: scope } : {}),
    type: ["task"],
    status: state.status,
    ...(state.priority.length ? { priority: state.priority.map(Number) } : {}),
    today: now,
    sort: state.tasks === "all" ? "priority" : "due",
    limit: 300,
    ...(state.tasks === "today" ? { to: now } : range ? { from: range.from, to: range.to } : {}),
  };
}

export function TasksSection({
  scope,
  state,
  set,
  now,
  weekStart,
  places,
  defaultTasks = "today",
  initial = null,
}: {
  scope: string | null;
  state: BoardState;
  set: SetBoard;
  now: Day;
  weekStart: number;
  // Where a new task can go; it starts on the scope's node when there is one.
  places: Array<{ value: string; label: string }>;
  // The range the page opens on: the address keeps only a range that differs from it.
  defaultTasks?: Range;
  // The first read, when the page made it ahead (`tasksInput`).
  initial?: Read<Browse> | null;
}) {
  const range = rangeOf(state.tasks, now, weekStart);
  const { data, error, stale } = useRead<Browse>("browse_items", tasksInput(scope, state, now, weekStart), initial);

  const what = state.status === "open" ? ["open task", "open tasks"] : ["done task", "done tasks"];
  const meta = !data || stale ? undefined : state.tasks === "today" && state.status === "open" ? lateAndToday(data.items, now) : `${range ? `${rangeLabel(range.from, range.to)} · ` : ""}${plural(data.total, what[0], what[1])}`;
  return (
    <section className="card board-section" aria-labelledby="tasks-title" id="tasks" data-section="tasks">
      <SectionHead id="tasks-title" title="Tasks" meta={meta !== undefined ? <span data-tasks-total={data!.total}>{meta}</span> : undefined}>
        <Tabs label="When they are due" value={state.tasks} onChange={(value) => set({ tasks: value === defaultTasks ? null : value })} options={RANGES.map((r) => ({ ...r, controls: "tasks-list" }))} />
        <div className="chip-row" role="group" aria-label="Priority">
          {PRIORITIES.map((priority) => (
            <Chip
              key={priority.value}
              pressed={state.priority.includes(priority.value)}
              count={stale ? undefined : (data?.counts.priority[priority.value] ?? 0)}
              onClick={() => set({ priority: toggleIn(state.priority, priority.value) })}
              data={`priority:${priority.value}`}
            >
              {priority.label}
            </Chip>
          ))}
        </div>
        <Tabs label="Open or done" value={state.status} onChange={(value) => set({ status: value === "open" ? null : value })} options={STATUS.map((s) => ({ ...s, controls: "tasks-list" }))} />
      </SectionHead>
      <QuickAdd nodeId={scope ?? undefined} type="task" places={places} />
      {error && (
        <p role="alert" className="inline-note" data-tone="alert">
          The tasks could not be {data ? "refreshed" : "read"}: {error}.
        </p>
      )}
      <div id="tasks-list" role="tabpanel" aria-labelledby="tasks-title" aria-busy={stale || undefined} data-stale={stale || undefined}>
        {!data ? (
          !error && <SectionSkeleton label="Loading the tasks" />
        ) : data.items.length === 0 ? (
          <TasksEmpty state={state} set={set} undated={data.counts.date.undated} />
        ) : (
          <TaskGroups state={state} items={data.items} now={now} scope={scope} />
        )}
        {data && data.total > data.items.length && <p className="t-meta">Showing the first {data.items.length} of {data.total}: narrow them with the filters.</p>}
      </div>
    </section>
  );
}

function lateAndToday(items: Item[], now: Day): string {
  const late = items.filter((item) => item.dueOn !== null && item.dueOn < now).length;
  return `${late} late · ${items.length - late} due today`;
}

function TaskGroups({ state, items, now, scope }: { state: BoardState; items: Item[]; now: Day; scope: string | null }) {
  if (state.tasks === "all" || state.status === "done") return <TaskRows items={items} scope={scope} />;
  if (state.tasks === "today") {
    const late = items.filter((item) => item.dueOn !== null && item.dueOn < now);
    const due = items.filter((item) => item.dueOn === now);
    return (
      <div className="stack">
        {late.length > 0 && (
          <section className="stack" aria-labelledby="tasks-late" data-group="late">
            <h3 id="tasks-late" className="t-label">
              Late
            </h3>
            <TaskRows items={late} scope={scope} />
          </section>
        )}
        {due.length > 0 && (
          <section className="stack" aria-labelledby="tasks-due" data-group="due">
            <h3 id="tasks-due" className="t-label">
              Due today
            </h3>
            <TaskRows items={due} scope={scope} />
          </section>
        )}
      </div>
    );
  }
  const days = [...new Set(items.map((item) => item.dueOn!))].sort();
  return (
    <div className="stack">
      {days.map((day) => (
        <section key={day} className="stack" aria-labelledby={`tasks-${day}`} data-group={day}>
          <h3 id={`tasks-${day}`} className="t-label">
            {day === now ? "Today" : day < now ? `${longDay(day)} · late` : longDay(day)}
          </h3>
          <TaskRows items={items.filter((item) => item.dueOn === day)} scope={scope} />
        </section>
      ))}
    </div>
  );
}

// The tasks of one group, each subtask under its task when both are in the group: a row of its own, indented on a guide
// and sharing the task's columns, so its priority and due date read under the task's; the task says how many of its
// subtasks are done. A subtask with subtasks of its own folds them behind one button that opens it, so the list stays
// two levels deep. A row says where it lives only when that is not the page's own node.
function TaskRows({ items, scope }: { items: Item[]; scope: string | null }) {
  const ids = new Set(items.map((item) => item.id));
  const children = new Map<string, Item[]>();
  for (const item of items) if (item.parentId && ids.has(item.parentId)) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  const top = items.filter((item) => !item.parentId || !ids.has(item.parentId));
  return <ItemList items={top}>{(item) => <TaskBranch task={item} branches={children} scope={scope} depth={1} />}</ItemList>;
}

function TaskBranch({ task, branches, scope, depth }: { task: Item; branches: Map<string, Item[]>; scope: string | null; depth: number }) {
  const { openItem } = useWorkspace();
  const below = branches.get(task.id) ?? [];
  const counted = task.subtasks;
  const progress = counted ? (
    <span className="t-meta nowrap" data-subtask-progress>
      {`${counted.done} of ${counted.open + counted.done} subtasks done`}
    </span>
  ) : undefined;
  return (
    // One box for the task and what hangs from it, so deleting the task folds its whole branch away.
    <div className="task-branch">
      <ItemRow item={task} showPath={depth === 1 && task.nodeId !== scope} below={progress} />
      {below.length > 0 &&
        (depth > 1 ? (
          <div className="subtasks-more-row">
            <Button variant="quiet" size="sm" className="subtasks-more" onClick={() => openItem(task)} data-subtasks-folded={below.length}>
              {plural(below.length, "subtask inside: open it", "subtasks inside: open it")}
            </Button>
          </div>
        ) : (
          <div className="subtasks" data-subtasks-of={task.id}>
            <ItemList nested items={below}>
              {(item) => <TaskBranch task={item} branches={branches} scope={scope} depth={depth + 1} />}
            </ItemList>
          </div>
        ))}
    </div>
  );
}

// An empty list says why: a filter emptied it, nothing falls due in the range, or nothing is done yet; with its action.
function TasksEmpty({ state, set, undated }: { state: BoardState; set: SetBoard; undated: number }) {
  if (state.priority.length > 0) {
    return (
      <div data-empty-reason="filters">
        <Empty text="No task matches the chosen priorities." action="Show every priority" onAction={() => set({ priority: null })} />
      </div>
    );
  }
  if (state.status === "done") return <Empty text="No task in this range is done yet." action="Show the open ones" onAction={() => set({ status: null })} />;
  if (state.tasks === "all") return <Empty text="No open tasks here. Add one with the field above." />;
  const what = state.tasks === "today" ? "No task is late or due today." : `Nothing falls due ${state.tasks === "week" ? "this week" : "this month"}.`;
  return (
    <div data-empty-reason={state.tasks}>
      <Empty
        text={undated > 0 ? `${what} ${plural(undated, "task has", "tasks have")} no due date: they never fall due.` : what}
        action="Show tasks of any date"
        onAction={() => set({ tasks: "all" })}
      />
    </div>
  );
}

// ---- Agenda: the events of the day, the week, or the month, from the accounts in view and the workspace's own. -------

type Events = { events: Array<CalendarEvent & { origin: "google" | "local" }>; failures: EventsFailure[] };
export type AgendaRead = { events: Events | null; failed: boolean; stale: boolean };

export function useAgenda(scope: string | null, range: AgendaRange, now: Day, weekStart: number): AgendaRead {
  const days = rangeOf(range, now, weekStart)!;
  const instants = instantsOf(days.from, days.to);
  const { data, error, stale } = useRead<Events>("browse_events", { ...(scope ? { node: scope } : {}), from: instants.from, to: instants.to, fromDay: days.from, toDay: days.to });
  // A read that failed whole is said once, as a failure of every calendar in view.
  const events = data ?? (error ? { events: [], failures: [{ accountId: "", accountEmail: "", reason: error }] } : null);
  return { events, failed: data === null && error !== null, stale };
}

// The events of today in the agenda as read: what a timed event covers counts, also when it started the day before.
export function eventsToday(agenda: AgendaRead, now: Day): EventsToday {
  if (agenda.failed) return "failed";
  if (!agenda.events || agenda.stale) return null;
  return { count: agenda.events.events.filter((event) => isToday(event, now)).length, complete: agenda.events.failures.length === 0 };
}

export function isToday(event: CalendarEvent, now: Day): boolean {
  if (event.allDay) {
    // A Google whole day ends the next day; the workspace's own says its last day.
    const last = event.origin === "google" ? addDays(event.end.slice(0, 10), -1) : event.end.slice(0, 10);
    return event.start.slice(0, 10) <= now && now <= last;
  }
  const dayStart = new Date(`${now}T00:00:00`).getTime();
  const dayEnd = new Date(`${addDays(now, 1)}T00:00:00`).getTime();
  const start = Date.parse(event.start);
  // It overlaps the day, or it is an instant inside it.
  return start < dayEnd && (Date.parse(event.end) > dayStart || start >= dayStart);
}

export function AgendaSection({ agenda, state, set, now, weekStart, calendarHref }: { agenda: AgendaRead; state: BoardState; set: SetBoard; now: Day; weekStart: number; calendarHref: string }) {
  const days = rangeOf(state.agenda, now, weekStart)!;
  const { events, stale } = agenda;
  return (
    <section className="card board-section" aria-labelledby="agenda-title" id="agenda" data-section="agenda">
      <SectionHead id="agenda-title" title="Agenda" meta={state.agenda === "today" ? longDay(now) : rangeLabel(days.from, days.to)}>
        <Tabs label="Which days" value={state.agenda} onChange={(value) => set({ agenda: value === "week" ? null : value })} options={AGENDA_RANGES.map((r) => ({ ...r, controls: "agenda-list" }))} />
      </SectionHead>
      <div id="agenda-list" role="tabpanel" aria-labelledby="agenda-title" className="section-body" aria-busy={stale || undefined} data-stale={stale || undefined}>
        {events?.failures.map((failure) => (
          <p key={failure.accountId} role="alert" className="inline-note" data-tone="alert">
            {failure.accountEmail || "The calendars"} could not be read: {failure.reason}
          </p>
        ))}
        {events === null ? (
          <SectionSkeleton label="Loading the agenda" />
        ) : events.events.length === 0 ? (
          // An empty agenda carries its own way to fill it: the calendar, where events are created.
          <div className="empty" data-agenda-empty>
            <p className="t-help">{`No events ${state.agenda === "today" ? "today" : state.agenda === "week" ? "this week" : "this month"} in the calendars in view.`}</p>
            <Link className={buttonClass({ size: "sm" })} href={calendarHref}>
              <span className="btn-label">Add an event</span>
            </Link>
          </div>
        ) : (
          <>
            <Agenda events={events.events} withDay={state.agenda !== "today"} />
            <div className="section-foot">
              <Link className="link" href={calendarHref}>
                Open the calendar
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ---- Clients and projects: one card each, with what is pending in it; a card is the way to its page. ------------------

// The four figures every card carries, in the same places, each a number over its words.
const CARD_FIGURES: Array<{ key: "open" | "late" | "dueToday" | "toReview"; one: string; many: string }> = [
  { key: "open", one: "open task", many: "open tasks" },
  { key: "late", one: "late", many: "late" },
  { key: "dueToday", one: "due today", many: "due today" },
  { key: "toReview", one: "to review", many: "to review" },
];

export function NodeCards({ nodes, tree, board, failed, empty }: { nodes: TreeNode[]; tree: TreeNode[]; board: Board | null; failed?: boolean; empty: ReactNode }) {
  if (nodes.length === 0) return <>{empty}</>;
  const figures = new Map((board?.nodes ?? []).map((entry) => [entry.id, entry]));
  // Clients first, then projects, each by name, as the sidebar lists them.
  const ordered = [...nodes].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "client" ? -1 : b.kind === "client" ? 1 : 0));
  return (
    <ul className="node-cards">
      {ordered.map((node) => {
        const own = figures.get(node.id);
        const children = tree.filter((child) => child.parentId === node.id);
        const many = node.kind === "client" ? "Projects" : "Subprojects";
        return (
          <li key={node.id} className="node-card" data-node-card={node.id}>
            <Link
              className="node-card-link"
              href={`/app/node/${node.id}`}
              onClick={(event) => plainClick(event) && requestFocus({ kind: "node", nodeId: node.id })}
            >
              <span className="t-meta">{KIND_NAME[node.kind]}</span>
              <span className="t-name node-card-name">{node.name}</span>
            </Link>
            <p className="t-meta node-card-children">
              {children.length === 0 ? `No ${many.toLowerCase()} yet` : `${many}: ${children.map((child) => child.name).join(", ")}`}
            </p>
            <dl className="node-card-figures" aria-busy={(own === undefined && !failed) || undefined}>
              {CARD_FIGURES.map((figure) => (
                <div key={figure.key} className="node-card-figure" data-tone={figure.key === "late" && (own?.late ?? 0) > 0 ? "alert" : undefined}>
                  <dt className="t-meta">{own ? noun(own[figure.key], figure.one, figure.many) : figure.many}</dt>
                  <dd className="node-card-value">
                    {own ? own[figure.key] : failed ? <span aria-label="Not read">—</span> : <span className="skeleton" style={{ width: "1.4rem" }} />}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

export const KIND_NAME: Record<TreeNode["kind"], string> = { client: "Client", project: "Project", subproject: "Subproject" };

export function ClientsAndProjects({ tree, board, failed, state, set }: { tree: TreeNode[] | null; board: Board | null; failed: boolean; state: BoardState; set: SetBoard }) {
  const roots = (tree ?? []).filter((node) => node.parentId === null && (state.kind === "all" || node.kind === state.kind));
  const clients = roots.filter((node) => node.kind === "client").length;
  const projects = roots.length - clients;
  const meta = [state.kind !== "project" && plural(clients, "client", "clients"), state.kind !== "client" && plural(projects, "project", "projects")].filter(Boolean).join(" · ");
  return (
    <section className="card board-section" aria-labelledby="nodes-title" id="clients-and-projects" data-section="nodes">
      <SectionHead id="nodes-title" title="Clients and projects" meta={tree ? meta : undefined}>
        <Tabs label="Which ones" value={state.kind} onChange={(value) => set({ kind: value === "all" ? null : value })} options={KINDS.map((k) => ({ ...k, controls: "nodes-list" }))} />
      </SectionHead>
      <div id="nodes-list" role="tabpanel" aria-labelledby="nodes-title">
        {tree === null ? (
          <SectionSkeleton label="Loading clients and projects" />
        ) : (
          <NodeCards
            nodes={roots}
            tree={tree}
            board={board}
            failed={failed}
            empty={<Empty text={state.kind === "client" ? "No clients yet: add one in the sidebar, under Clients." : state.kind === "project" ? "No projects of your own yet: add one in the sidebar, under Projects." : "Nothing here yet: add a client or a project in the sidebar."} />}
          />
        )}
      </div>
    </section>
  );
}

// ---- To review: what waits for a look, open or already reviewed. -------------------------------------------------------

export function ReviewSection({ scope, state, set, addTo }: { scope: string | null; state: BoardState; set: SetBoard; addTo?: string }) {
  const { data, error, stale } = useRead<Browse>("browse_items", { ...(scope ? { node: scope } : {}), type: ["review"], status: state.review, sort: "newest", limit: 50 });
  return (
    <section className="card board-section" aria-labelledby="review-title" id="to-review" data-section="review">
      <SectionHead id="review-title" title="To review" meta={data && !stale ? `${data.total} ${state.review === "open" ? "waiting" : "reviewed"}` : undefined}>
        <Tabs label="Waiting or reviewed" value={state.review} onChange={(value) => set({ review: value === "open" ? null : value })} options={[{ value: "open" as const, label: "Waiting", controls: "review-list" }, { value: "done" as const, label: "Reviewed", controls: "review-list" }]} />
      </SectionHead>
      {addTo && <QuickAdd nodeId={addTo} type="review" />}
      <div id="review-list" role="tabpanel" aria-labelledby="review-title" aria-busy={stale || undefined} data-stale={stale || undefined}>
        {error && (
          <p role="alert" className="inline-note" data-tone="alert">
            What is to review could not be read: {error}.
          </p>
        )}
        {!data ? (
          !error && <SectionSkeleton label="Loading what is to review" />
        ) : data.items.length === 0 ? (
          <Empty text={state.review === "open" ? "Nothing waits for a review." : "Nothing reviewed yet."} />
        ) : (
          <ItemList items={data.items}>{(item) => <ItemRow item={item} showPath={item.nodeId !== scope} />}</ItemList>
        )}
      </div>
    </section>
  );
}

// ---- Activity: what was created, changed, completed or deleted in the last days, and by whom. -------------------------

type Updates = { created: Item[]; changed: Item[]; completed: Item[]; deleted: Item[] };
type Entry = { kind: keyof Updates; item: Item; at: string; who: Source; agent: string | null };

const KINDS_OF_CHANGE: Array<Entry["kind"]> = ["created", "changed", "completed", "deleted"];
const ACTIVITY_DAYS = 7;
// The latest few at a glance; the rest of the days one press away.
const FIRST_SHOWN = 6;

// What happened, in a few words: "Added task", "Completed task"; what waits for review reads as an item to review, and
// a finished one as reviewed.
function happened(entry: Entry): string {
  const verb = { created: "Added", changed: "Changed", completed: "Completed", deleted: "Deleted" }[entry.kind];
  if (entry.item.type === "review") return entry.kind === "completed" ? "Reviewed" : `${verb} item to review`;
  return `${verb} ${TYPE_NAMES[entry.item.type].toLowerCase()}`;
}

const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ActivitySection({ scope, state, set }: { scope: string | null; state: BoardState; set: SetBoard }) {
  const { openItem } = useWorkspace();
  const [all, setAll] = useState(false);
  // The window is fixed when the section mounts: a read again after a change keeps the same days.
  const [since] = useState(() => new Date(Date.now() - ACTIVITY_DAYS * 24 * 3_600_000).toISOString());
  const { data, error, stale } = useRead<Updates>("get_updates_since", { since, ...(scope ? { node: scope } : {}) });

  const entries = useMemo(() => {
    if (!data) return [];
    const list: Entry[] = KINDS_OF_CHANGE.flatMap((kind) =>
      data[kind].map((item) => ({
        kind,
        item,
        at: kind === "created" ? item.createdAt : kind === "completed" ? (item.completedAt ?? item.updatedAt ?? item.createdAt) : (item.updatedAt ?? item.createdAt),
        who: kind === "created" ? item.source : (item.changedSource ?? item.source),
        agent: kind === "created" ? item.agentLabel : (item.changedAgentLabel ?? null),
      })),
    );
    return list.filter((entry) => (state.who.length === 0 || state.who.includes(entry.who)) && (state.what.length === 0 || state.what.includes(entry.item.type))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [data, state.who, state.what]);

  return (
    <section className="card board-section" aria-labelledby="activity-title" id="activity" data-section="activity">
      <SectionHead id="activity-title" title="Activity" meta={`The last ${ACTIVITY_DAYS} days`}>
        <div className="chip-row" role="group" aria-label="Who did it">
          {WHO.map((who) => (
            <Chip key={who} pressed={state.who.includes(who)} onClick={() => set({ who: toggleIn(state.who, who) })} data={`who:${who}`}>
              {sourceName(who, null)}
            </Chip>
          ))}
        </div>
        <div className="chip-row" role="group" aria-label="What it was">
          {WHAT.map((type) => (
            <Chip key={type} pressed={state.what.includes(type)} onClick={() => set({ what: toggleIn(state.what, type) })} data={`what:${type}`}>
              {TYPE_NAMES[type]}
            </Chip>
          ))}
        </div>
      </SectionHead>
      {error && (
        <p role="alert" className="inline-note" data-tone="alert">
          The activity could not be read: {error}.
        </p>
      )}
      {!data ? (
        !error && <SectionSkeleton label="Loading the activity" />
      ) : entries.length === 0 ? (
        <Empty
          text={state.who.length || state.what.length ? "Nothing matches the chosen filters in these days." : `Nothing changed in the last ${ACTIVITY_DAYS} days.`}
          {...(state.who.length || state.what.length ? { action: "Show everything", onAction: () => set({ who: null, what: null }) } : {})}
        />
      ) : (
        <div aria-busy={stale || undefined} data-stale={stale || undefined}>
          <ol className="activity" id="activity-list">
            {entries.slice(0, all ? entries.length : FIRST_SHOWN).map((entry) => (
              <li key={`${entry.kind}:${entry.item.id}`} className="activity-row" data-activity={entry.kind}>
                <span className="t-meta activity-when">{stamp(entry.at)}</span>
                <span className="activity-what">
                  {entry.kind === "deleted" ? (
                    <Link className="row-title t-value" href="/app/trash" aria-label={`“${entry.item.title}”, in the trash`}>
                      {entry.item.title}
                    </Link>
                  ) : (
                    <button type="button" className="row-title t-value" onClick={() => openItem(entry.item)} aria-label={`Open “${entry.item.title}”`}>
                      {entry.item.title}
                    </button>
                  )}
                  <span className="t-meta activity-where">
                    <span>{happened(entry)}</span>
                    <span aria-hidden="true">·</span>
                    <Link className="link link-meta" href={`/app/node/${entry.item.nodeId}`}>
                      <PathText path={entry.item.nodePath} />
                    </Link>
                  </span>
                </span>
                <span className="pill activity-who" data-tone={entry.who === "chat" ? "accent" : entry.who === "agent" ? "info" : undefined}>
                  {sourceName(entry.who, entry.agent)}
                </span>
              </li>
            ))}
          </ol>
          {entries.length > FIRST_SHOWN && (
            <div className="section-foot">
              <Button size="sm" variant="quiet" aria-controls="activity-list" aria-expanded={all} onClick={() => setAll((open) => !open)} data-activity-more>
                {/* The section's head already says which days: the button stays on one line at any width. */}
                {all ? `Show the latest ${FIRST_SHOWN}` : `Show all ${entries.length} changes`}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// The places a new task can go: every client, project and subproject in reach, by its path; on a node's page, the node by
// its name and what is below it by its path from there, which the page already names.
export function placesIn(tree: TreeNode[] | null, under: string | null): Array<{ value: string; label: string }> {
  const nodes = tree ?? [];
  if (!under) return nodes.map((node) => ({ value: node.id, label: node.path }));
  const inside = new Set([under]);
  for (const node of nodes) if (node.parentId && inside.has(node.parentId)) inside.add(node.id);
  const root = nodes.find((node) => node.id === under);
  const prefix = root ? `${root.path} / ` : "";
  return nodes
    .filter((node) => inside.has(node.id))
    .map((node) => ({ value: node.id, label: node.id === under ? node.name : node.path.startsWith(prefix) ? node.path.slice(prefix.length) : node.path }));
}
