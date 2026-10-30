"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  ViewTransition,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { Select } from "@/components/ui/select";
import { addDays, addMonths, dayOf, firstWeekday, instantsOf, isDay, LOCALE, monthGrid, monthTitle, rangeLabel, today, weekdayNames, weekOf, type Day } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { PRODUCT_NAME } from "@/lib/product";
import { get, post, tool, type EventsFailure, type Item, type TreeNode } from "../client-api";
import { PageHeader } from "../page-header";
import { AccountFilter, ALL, branchOf, EVENTS, GENERAL, ITEMS, lineOf, PlaceFilter, placeFromUrl } from "../place-filters";
import { count, openTaskDetail, TaskCircle, timeLabel, type TaskData } from "../task-row";
import { useSwap } from "../use-swap";
import { activates, useGridKeys } from "./grid-keys";
import { useChatScope, useWorkspace } from "../workspace";
import "../../styles/calendar.css";

// An event as `browse_events` gives it: a connected account's or the workspace's own.
type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  link: string | null;
  calendarId: string;
  calendarName: string;
  color: string | null;
  accountId: string;
  accountEmail: string;
  fromNodeId: string;
  origin: "google" | "local";
  localId: string | null;
  nodeId: string | null;
  nodePath: string | null;
  linkedNodeIds: string[];
};
type Account = { id: string; email: string; status: string; isDemo: boolean; nodeIds: string[]; calendars: Array<{ id: string; name: string; selected: boolean }> };
type TasksAnswer = {
  groups: { overdue: { tasks: TaskData[] }; today: { tasks: TaskData[] }; upcoming: { days: Array<{ tasks: TaskData[] }> }; noDate: { tasks: TaskData[] } };
  completed: { tasks: TaskData[] } | null;
};
// What one read brought, with the range it read: what is drawn is always the range its data belongs to.
type Loaded = { key: string; view: View; anchor: Day; from: Day; to: Day; events: CalEvent[]; tasks: TaskData[]; failures: EventsFailure[]; accounts: Account[] };
type View = "week" | "month";
// Where a new event starts: its day, and its hour when a gap of the week's hours was pressed.
type Draft = { day: Day; time: string | null };

const VIEWS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const OWN_CALENDAR = `${PRODUCT_NAME} calendar`;
// How many chips the all-day strip of a week shows in a day before it says how many more it holds.
const ALL_DAY_CHIPS = 3;

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <Calendar />
    </Suspense>
  );
}

const eventKey = (event: CalEvent) => `${event.origin}:${event.accountId}:${event.calendarId}:${event.id}`;

// The days an event covers in the person's calendar: a whole day from its first to its last (included), a timed one the
// days it touches.
function daysOf(event: CalEvent): Day[] {
  const first = event.allDay ? event.start.slice(0, 10) : dayOf(new Date(event.start));
  const last = event.allDay ? event.end.slice(0, 10) : dayOf(new Date(Date.parse(event.end) - 1));
  const days: Day[] = [];
  for (let day = first; day <= last && days.length < 62; day = addDays(day, 1)) days.push(day);
  return days.length ? days : [first];
}

// A timed event that starts and ends on one day sits on that day's hours; any other goes with the whole-day ones.
const onHours = (event: CalEvent) => !event.allDay && daysOf(event).length === 1;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
const minutesOf = (iso: string) => {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
};
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fullDay = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric" }).format(new Date(y, m - 1, d));
};
const shortDay = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { weekday: "short", month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
};
const hourName = (hour: number) => new Intl.DateTimeFormat(LOCALE, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));

function whenText(event: CalEvent): string {
  const days = daysOf(event);
  if (event.allDay) return days.length > 1 ? `${shortDay(days[0])} to ${shortDay(days.at(-1)!)}, all day` : `${shortDay(days[0])}, all day`;
  return days.length > 1
    ? `${shortDay(days[0])}, ${clock(event.start)} to ${shortDay(days.at(-1)!)}, ${clock(event.end)}`
    : `${shortDay(days[0])}, ${clock(event.start)} to ${clock(event.end)}`;
}

// Reading a narrow window: the week becomes a list of days and the month keeps only its numbers, with the chosen day
// below. Read once mounted; the server never paints the calendar.
const NARROW = "(width < 48rem)";
function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const noSubscription = () => () => {};

function Calendar() {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const { version, tree, notify, touch, saving } = useWorkspace();
  useChatScope(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: View = params.get("view") === "month" ? "month" : "week";
  const anchor = isDay(params.get("date")) ? (params.get("date") as Day) : today();
  const place = placeFromUrl(params.get("place"), tree);
  const accountParam = params.get("account");
  const [weekStart] = useState(() => firstWeekday());
  const range = useMemo(() => {
    if (view === "week") return weekOf(anchor, weekStart);
    const weeks = monthGrid(anchor, weekStart);
    return { from: weeks[0][0], to: weeks.at(-1)!.at(-1)! };
  }, [view, anchor, weekStart]);
  const rangeKey = `${view}:${range.from}:${range.to}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [chosenDay, setChosenDay] = useState<Day | null>(null);
  // A task moved here shows on its new day before the server answers.
  const [moved, setMoved] = useState<Map<string, Day>>(new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<Day | null>(null);

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
    const instants = instantsOf(range.from, range.to);
    void Promise.all([
      tool<{ events: CalEvent[]; failures: EventsFailure[] }>("browse_events", { from: instants.from, to: instants.to, fromDay: range.from, toDay: range.to }),
      tool<TasksAnswer>("get_tasks", { today: today(), withCompleted: true }),
      get<{ accounts: Account[] }>("/api/accounts"),
    ]).then(([events, tasks, accounts]) => {
      if (!live) return;
      if (!events.ok || !tasks.ok) {
        // A refresh that fails keeps what was on screen and says so in its place.
        setReadError(!events.ok ? events.message : !tasks.ok ? tasks.message : "");
        return;
      }
      const all = [
        ...tasks.groups.overdue.tasks,
        ...tasks.groups.today.tasks,
        ...tasks.groups.upcoming.days.flatMap((day) => day.tasks),
        ...(tasks.completed?.tasks ?? []),
      ];
      setReadError(null);
      setMoved(new Map());
      setLoaded({
        key: rangeKey,
        view,
        anchor,
        from: range.from,
        to: range.to,
        events: events.events,
        tasks: all,
        failures: events.failures,
        accounts: accounts.ok ? accounts.accounts : [],
      });
    });
    return () => {
      live = false;
    };
    // The view and the anchor are what the range is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, rangeKey, version]);

  // What a place brings: a task of its branch; an own event of its branch or linked to it; a connected account's event
  // when the account hangs from the place or above it (the place sees it), or when it is linked to the branch.
  const byPlace = useMemo(() => {
    const accountsById = new Map((loaded?.accounts ?? []).map((account) => [account.id, account]));
    const branches = new Map((tree ?? []).map((node) => [node.id, branchOf(tree, node.id)]));
    const lines = new Map((tree ?? []).map((node) => [node.id, lineOf(tree, node.id)]));
    const taskIn = (task: TaskData, where: string) => (where === ALL ? true : where === GENERAL ? task.nodeId === null : Boolean(task.nodeId && branches.get(where)?.has(task.nodeId)));
    const eventIn = (event: CalEvent, where: string) => {
      if (where === ALL) return true;
      if (where === GENERAL) return event.origin === "local" && event.nodeId === null;
      const branch = branches.get(where);
      if (!branch) return false;
      if (event.linkedNodeIds.some((id) => branch.has(id))) return true;
      if (event.origin === "local") return Boolean(event.nodeId && branch.has(event.nodeId));
      const line = lines.get(where)!;
      return Boolean(accountsById.get(event.accountId)?.nodeIds.some((id) => line.has(id)));
    };
    return { taskIn, eventIn };
  }, [loaded, tree]);

  // The range of the data on screen, which is the one asked for once it arrived.
  const shownFrom = loaded?.from ?? range.from;
  const shownTo = loaded?.to ?? range.to;
  const inRange = (day: string | null) => Boolean(day && day >= shownFrom && day <= shownTo);
  const tasksAll = useMemo(() => (loaded?.tasks ?? []).map((task) => (moved.has(task.id) ? { ...task, dueOn: moved.get(task.id)! } : task)), [loaded, moved]);
  const placeEvents = useMemo(() => (loaded?.events ?? []).filter((event) => byPlace.eventIn(event, place)), [loaded, byPlace, place]);
  const account = accountParam && (loaded?.accounts ?? []).some((entry) => entry.id === accountParam) ? accountParam : ALL;
  const events = useMemo(() => placeEvents.filter((event) => account === ALL || (event.origin === "google" && event.accountId === account)), [placeEvents, account]);
  const tasks = useMemo(
    () => tasksAll.filter((task) => Boolean(task.dueOn && task.dueOn >= shownFrom && task.dueOn <= shownTo) && byPlace.taskIn(task, place)),
    [tasksAll, shownFrom, shownTo, byPlace, place],
  );

  // Each filter's options with what they bring, the other filter applied.
  const placeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const eventsOfAccount = (loaded?.events ?? []).filter((event) => account === ALL || (event.origin === "google" && event.accountId === account));
    const rangeTasks = tasksAll.filter((task) => inRange(task.dueOn));
    for (const where of [ALL, GENERAL, ...(tree ?? []).map((node) => node.id)]) {
      counts.set(where, eventsOfAccount.filter((event) => byPlace.eventIn(event, where)).length + rangeTasks.filter((task) => byPlace.taskIn(task, where)).length);
    }
    return counts;
    // The range is the loaded one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tasksAll, tree, account, byPlace]);
  const accountCounts = new Map<string, number>([[ALL, placeEvents.filter((event) => event.origin === "google").length]]);
  for (const entry of loaded?.accounts ?? []) accountCounts.set(entry.id, placeEvents.filter((event) => event.origin === "google" && event.accountId === entry.id).length);

  const byDay = useMemo(() => {
    const map = new Map<Day, { events: CalEvent[]; tasks: TaskData[] }>();
    const slot = (day: Day) => map.get(day) ?? (map.set(day, { events: [], tasks: [] }), map.get(day)!);
    for (const event of events) for (const day of daysOf(event)) slot(day).events.push(event);
    for (const task of tasks) slot(task.dueOn!).tasks.push(task);
    for (const entry of map.values()) {
      entry.tasks.sort((a, b) => (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || (a.priority ?? 4) - (b.priority ?? 4));
    }
    return map;
  }, [events, tasks]);

  // Another range leaves before the next one enters; the same range with newer data repaints in place.
  const model = useMemo(
    () => (loaded ? { byDay, view: loaded.view, anchor: loaded.anchor, from: loaded.from, to: loaded.to } : null),
    [byDay, loaded],
  );
  const swap = useSwap(model, loaded?.key ?? "none");
  const shown = swap.shown;
  const stale = Boolean(loaded && loaded.key !== rangeKey);

  const step = (direction: 1 | -1) => set({ date: view === "month" ? addMonths(anchor, direction) : addDays(anchor, 7 * direction) });
  const writable = (loaded?.accounts ?? []).filter((entry) => !entry.isDemo && entry.status === "active");
  const todayDay = today();
  const isCurrent = view === "week" ? todayDay >= range.from && todayDay <= range.to : todayDay.slice(0, 7) === anchor.slice(0, 7);
  const title = view === "month" ? monthTitle(anchor) : rangeLabel(range.from, range.to);
  const selectedEvent = openEvent ? ((loaded?.events ?? []).find((event) => eventKey(event) === openEvent) ?? null) : null;

  // A task taken to another day: it shows there at once, and goes back saying so if the server refuses.
  async function moveTask(task: TaskData, day: Day, keepFocus = false) {
    if (task.dueOn === day) return;
    const from = task.dueOn;
    setMoved((current) => new Map(current).set(task.id, day));
    const answer = await tool("update_item", { id: task.id, dueOn: day });
    if (!answer.ok) {
      setMoved((current) => {
        const next = new Map(current);
        next.delete(task.id);
        return next;
      });
      return notify({ text: `“${inlinePlain(task.title)}” could not be moved: ${answer.message}`, tone: "error" });
    }
    touch();
    notify({
      text: `Moved “${inlinePlain(task.title)}” to ${shortDay(day)}`,
      tone: "status",
      undo: () => void saving(tool("update_item", { id: task.id, dueOn: from })),
    });
    // A move made from the keyboard keeps the focus on the task, also once its notice has shown.
    if (keepFocus) focusTask(task.id);
  }

  function focusTask(id: string) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cal-task="${id}"] .cal-task-open`)?.focus({ preventScroll: false })),
    );
  }

  // The keyboard moves the focused task a day with Alt and the side arrows, a week with Alt and the up and down arrows.
  function onTaskKey(event: KeyboardEvent<HTMLElement>, task: TaskData) {
    if (!event.altKey || !task.dueOn) return;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const day = addDays(task.dueOn, offset);
    void moveTask(task, day, true);
    // The focus stays on the task in its new day.
    focusTask(task.id);
    if (day < range.from || day > range.to) step(offset > 0 ? 1 : -1);
  }

  const dropOn = (day: Day) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (overDay !== day) setOverDay(day);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null) && overDay === day) setOverDay(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const task = tasksAll.find((entry) => entry.id === dragging);
      setOverDay(null);
      setDragging(null);
      if (task) void moveTask(task, day);
    },
    "data-drop-over": overDay === day ? "" : undefined,
  });

  const chipProps: ChipHandlers = {
    onOpenEvent: (event) => setOpenEvent(eventKey(event)),
    onTaskKey,
    onDragStart: (task) => setDragging(task.id),
    onDragEnd: () => {
      setDragging(null);
      setOverDay(null);
    },
    list: tasks,
  };

  // A press on a day's free space starts an event there; what the press landed on —an event, a task, a control— does
  // its own thing.
  function onGap(event: MouseEvent<HTMLElement>, day: Day, time: string | null) {
    if ((event.target as Element).closest("button, a, [draggable='true'], [role='menu']")) return;
    setDraft({ day, time });
  }

  if (!mounted) return null;
  const counted = `${count(events.length, "event", "events")} and ${count(tasks.length, "task", "tasks")}`;
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page cal-page" data-calendar={view}>
        <PageHeader
          title="Calendar"
          count={loaded ? counted : "Reading the calendar…"}
          filters={
            <>
              <PlaceFilter value={place} tree={tree} counts={placeCounts} unit={ITEMS} onChange={(value) => set({ place: value === ALL ? null : value })} />
              <AccountFilter
                value={account}
                accounts={loaded?.accounts ?? []}
                counts={accountCounts}
                unit={EVENTS}
                onChange={(value) => set({ account: value === ALL ? null : value })}
              />
            </>
          }
          views={{ label: "Calendar view", value: view, options: VIEWS, onChange: (value) => set({ view: value === "week" ? null : value }) }}
          chat
        />

        <section className="card cal-card" aria-labelledby="cal-range" aria-busy={!loaded || loaded.key !== rangeKey}>
          <div className="cal-bar">
            <h2 id="cal-range" className="t-title cal-range" aria-live="polite">
              {title}
            </h2>
            <div className="cal-steps" role="group" aria-label="Move through the calendar">
              <Button size="sm" onClick={() => step(-1)}>
                Previous
              </Button>
              <Button size="sm" onClick={() => set({ date: null })} disabled={isCurrent} aria-label={view === "week" ? "Today: back to this week" : "Today: back to this month"}>
                Today
              </Button>
              <Button size="sm" onClick={() => step(1)}>
                Next
              </Button>
              <Button size="sm" variant="primary" onClick={() => setDraft({ day: chosenDay ?? (isCurrent ? todayDay : range.from), time: null })}>
                New event
              </Button>
            </div>
          </div>

          {readError && (
            <p role="alert" className="inline-note" data-tone="alert">
              The calendar could not be read again: {readError}. What shows is from the last read.
            </p>
          )}
          {/* A sample account has no calendar to read: what the events source says of it is not a failure. */}
          {loaded?.failures.filter((failure) => !loaded.accounts.some((entry) => entry.id === failure.accountId && entry.isDemo)).map((failure) => (
            <p key={failure.accountId || "accounts"} role="alert" className="inline-note" data-tone="alert">
              {failure.accountEmail ? `The calendar of ${failure.accountEmail} could not be read: ${failure.reason}` : `Some calendars could not be read: ${failure.reason}`}
            </p>
          ))}

          {!shown ? (
            <CalendarSkeleton view={view} />
          ) : (
            <div className="cal-body" data-leaving={swap.leaving ? "" : undefined} data-stale={stale ? "" : undefined} data-cal-body={swap.shownKey}>
              {shown.view === "week" ? (
                narrow ? (
                  <WeekList days={daysBetween(shown.from, shown.to)} byDay={shown.byDay} chips={chipProps} dropOn={dropOn} onAdd={(day) => setDraft({ day, time: null })} />
                ) : (
                  <WeekGrid days={daysBetween(shown.from, shown.to)} byDay={shown.byDay} chips={chipProps} dropOn={dropOn} onGap={onGap} onCreate={(day, time) => setDraft({ day, time })} />
                )
              ) : (
                <MonthGrid
                  weeks={monthGrid(shown.anchor, weekStart)}
                  month={shown.anchor.slice(0, 7)}
                  names={weekdayNames(weekStart)}
                  byDay={shown.byDay}
                  chips={chipProps}
                  dropOn={dropOn}
                  onGap={onGap}
                  onCreate={(day) => setDraft({ day, time: null })}
                  narrow={narrow}
                  chosen={chosenDay}
                  onChoose={setChosenDay}
                  onMore={(day) => set({ view: null, date: day })}
                />
              )}
              {shown.view === "month" && narrow && (
                <WeekList
                  days={[chosenDay && chosenDay.slice(0, 7) === shown.anchor.slice(0, 7) ? chosenDay : todayDay.slice(0, 7) === shown.anchor.slice(0, 7) ? todayDay : `${shown.anchor.slice(0, 7)}-01`]}
                  byDay={shown.byDay}
                  chips={chipProps}
                  dropOn={dropOn}
                  onAdd={(day) => setDraft({ day, time: null })}
                />
              )}
              {!stale && events.length === 0 && tasks.length === 0 && (
                <p className="t-help cal-empty">
                  {place === ALL && account === ALL
                    ? `Nothing in this ${view === "week" ? "week" : "month"}: no events and no tasks due. "New event" adds one.`
                    : `Nothing in this ${view === "week" ? "week" : "month"} for the chosen place and account.`}
                </p>
              )}
            </div>
          )}
        </section>

        <EventComposer
          draft={draft}
          place={place}
          tree={tree}
          accounts={writable}
          demoOnly={(loaded?.accounts ?? []).length > 0 && writable.length === 0}
          onClose={() => setDraft(null)}
        />
        <EventDetail
          event={selectedEvent}
          tree={tree}
          tasks={tasksAll}
          onClose={() => setOpenEvent(null)}
        />
      </div>
    </ViewTransition>
  );
}

function daysBetween(from: Day, to: Day): Day[] {
  const days: Day[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

type ChipHandlers = {
  onOpenEvent: (event: CalEvent) => void;
  onTaskKey: (event: KeyboardEvent<HTMLElement>, task: TaskData) => void;
  onDragStart: (task: TaskData) => void;
  onDragEnd: () => void;
  list: TaskData[];
};
type DropOn = (day: Day) => Record<string, unknown>;

// ---- The pieces of a day ----------------------------------------------------------------------------------------------

function nodeColor(tree: TreeNode[] | null, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return tree?.find((node) => node.id === id)?.color ?? undefined;
}

function EventChip({ event, chips, style, timed }: { event: CalEvent; chips: ChipHandlers; style?: CSSProperties; timed?: boolean }) {
  const { tree } = useWorkspace();
  const color = nodeColor(tree, event.nodeId ?? event.linkedNodeIds[0] ?? event.fromNodeId);
  const when = event.allDay ? "All day" : clock(event.start);
  return (
    <button
      type="button"
      className="cal-event"
      data-color={color}
      data-timed={timed ? "" : undefined}
      data-origin={event.origin}
      style={style}
      onClick={() => chips.onOpenEvent(event)}
      data-cal-event={event.id}
    >
      {/* The name is what shows, then what the reader also needs: the whole moment. */}
      <span className="cal-event-when">{when}</span>
      <span className="cal-event-title">{event.title}</span>
      <span className="sr-only">, event, {whenText(event)}</span>
    </button>
  );
}

function TaskChip({ task, chips, style, timed }: { task: TaskData; chips: ChipHandlers; style?: CSSProperties; timed?: boolean }) {
  const [done, setDone] = useState(task.status === "done");
  const { notify, touch, saving } = useWorkspace();
  const fine = useSyncExternalStore(subscribeFine, () => window.matchMedia("(pointer: fine)").matches, () => false);
  async function toggle() {
    const next = !done;
    setDone(next);
    const answer = await tool("update_item", { id: task.id, status: next ? "done" : "open" });
    if (!answer.ok) {
      setDone(!next);
      return notify({ text: `“${inlinePlain(task.title)}” could not be changed: ${answer.message}`, tone: "error" });
    }
    touch();
    notify({
      text: next ? `Completed “${inlinePlain(task.title)}”` : `Opened “${inlinePlain(task.title)}” again`,
      tone: "status",
      undo: () => void saving(tool("update_item", { id: task.id, status: next ? "open" : "done" })),
    });
  }
  return (
    <div
      className="cal-task"
      data-cal-task={task.id}
      data-color={task.color ?? undefined}
      data-done={done ? "" : undefined}
      data-timed={timed ? "" : undefined}
      style={style}
      draggable={fine && task.status === "open"}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", inlinePlain(task.title));
        event.dataTransfer.effectAllowed = "move";
        chips.onDragStart(task);
      }}
      onDragEnd={chips.onDragEnd}
    >
      <TaskCircle title={task.title} priority={task.priority} done={done} onToggle={() => void toggle()} className="cal-task-circle" />
      <button
        type="button"
        className="cal-task-open"
        onClick={() => openTaskDetail({ id: task.id, task, list: chips.list })}
        onKeyDown={(event) => chips.onTaskKey(event, task)}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
      >
        {task.dueTime && <span className="cal-task-when">{timeLabel(task.dueTime)}</span>}
        <span className="cal-task-title">{inlinePlain(task.title)}</span>
        <span className="sr-only">, task. Alt with the arrows moves it to another day</span>
      </button>
    </div>
  );
}

function subscribeFine(onChange: () => void) {
  const query = window.matchMedia("(pointer: fine)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// ---- The week: its days side by side, the whole-day band on top and the hours below ----------------------------------

const HOUR_REM = 3;

function WeekGrid({
  days,
  byDay,
  chips,
  dropOn,
  onGap,
  onCreate,
}: {
  days: Day[];
  byDay: Map<Day, { events: CalEvent[]; tasks: TaskData[] }>;
  chips: ChipHandlers;
  dropOn: DropOn;
  onGap: (event: MouseEvent<HTMLElement>, day: Day, time: string | null) => void;
  // A new event from the keys: on a day's whole-day cell, or at one of its hours.
  onCreate: (day: Day, time: string | null) => void;
}) {
  const now = today();
  // The hours shown: the working day, widened to whatever falls outside it.
  let first = 8;
  let last = 19;
  for (const day of days) {
    const entry = byDay.get(day);
    for (const event of entry?.events ?? []) {
      if (!onHours(event)) continue;
      first = Math.min(first, Math.floor(minutesOf(event.start) / 60));
      last = Math.max(last, Math.ceil(minutesOf(event.end) / 60) - 1);
    }
    for (const task of entry?.tasks ?? []) {
      if (!task.dueTime) continue;
      const hour = Number(task.dueTime.slice(0, 2));
      first = Math.min(first, hour);
      last = Math.max(last, hour);
    }
  }
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const top = (minutes: number) => `${((minutes - first * 60) / 60) * HOUR_REM}rem`;
  // Its cells for the keys: the whole-day row, then one row per hour, a column per day; entered on today's whole day.
  const grid = useGridKeys({ rows: hours.length + 1, cols: days.length }, { row: 0, col: Math.max(0, days.indexOf(now)) });
  const hint = useId();

  return (
    <div
      className="cal-week"
      role="grid"
      aria-label="The week"
      aria-describedby={hint}
      style={{ "--days": days.length } as CSSProperties}
      onKeyDown={grid.onKeyDown}
      onFocus={grid.onFocus}
    >
      <span id={hint} className="sr-only">
        The arrows move between days and hours; Enter adds an event there.
      </span>
      <div className="cal-week-row cal-week-head" role="row">
        <span className="cal-gutter" aria-hidden="true" />
        {days.map((day) => (
          <div key={day} role="columnheader" className="cal-week-day" aria-current={day === now ? "date" : undefined}>
            <span className="cal-week-name">{new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(new Date(`${day}T12:00:00`))}</span>
            <span className="cal-week-num">{Number(day.slice(8))}</span>
          </div>
        ))}
      </div>
      <div className="cal-week-row cal-allday" role="row">
        <span className="cal-gutter t-meta">All day</span>
        {days.map((day, column) => {
          const entry = byDay.get(day);
          // The strip is a cell of a seventh of the week: three chips read, and the rest is said by its number instead of
          // being cut to a few letters.
          const items = [
            ...(entry?.events ?? []).filter((event) => !onHours(event)).map((event) => <EventChip key={eventKey(event)} event={event} chips={chips} />),
            ...(entry?.tasks ?? []).filter((task) => !task.dueTime).map((task) => <TaskChip key={task.id} task={task} chips={chips} />),
          ];
          const more = items.length - ALL_DAY_CHIPS;
          return (
            <div
              key={day}
              role="gridcell"
              className="cal-slot"
              data-day={day}
              onClick={(event) => onGap(event, day, null)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || !activates(event.key)) return;
                event.preventDefault();
                onCreate(day, null);
              }}
              {...grid.cell(0, column)}
              {...dropOn(day)}
            >
              {items.slice(0, ALL_DAY_CHIPS)}
              {more > 0 && <span className="cal-more cal-more-band">+{more} more</span>}
              <span className="sr-only">{fullDay(day)}, all day</span>
              <span className="cal-add-hint" aria-hidden="true">
                Add event
              </span>
            </div>
          );
        })}
      </div>
      <div className="cal-week-row cal-hours" role="row" style={{ "--hours": hours.length } as CSSProperties}>
        <div className="cal-gutter cal-hour-names" aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour} className="t-meta" style={{ top: top(hour * 60) }}>
              {hourName(hour)}
            </span>
          ))}
        </div>
        {days.map((day, column) => {
          const entry = byDay.get(day);
          const timed = [
            ...(entry?.events ?? []).filter(onHours).map((event) => ({ kind: "event" as const, key: eventKey(event), start: minutesOf(event.start), end: Math.max(minutesOf(event.end), minutesOf(event.start) + 30), event })),
            ...(entry?.tasks ?? []).filter((task) => task.dueTime).map((task) => {
              const [h, m] = task.dueTime!.split(":").map(Number);
              return { kind: "task" as const, key: task.id, start: h * 60 + m, end: h * 60 + m + 30, task };
            }),
          ];
          const laned = lanes(timed);
          return (
            <div
              key={day}
              role="gridcell"
              className="cal-day-hours"
              data-day={day}
              data-today={day === now ? "" : undefined}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
                const minutes = first * 60 + Math.floor(((event.clientY - box.top) / (HOUR_REM * rem)) * 2) * 30;
                onGap(event, day, hhmm(Math.max(0, Math.min(23 * 60 + 30, minutes))));
              }}
              {...dropOn(day)}
            >
              {/* Each hour is a cell for the keys: Enter or Space adds an event at it. The pointer passes through them to
                  the column, which reads the half hour pressed. */}
              {hours.map((hour, index) => (
                <button
                  key={hour}
                  type="button"
                  className="cal-hour-slot"
                  style={{ top: top(hour * 60) }}
                  aria-label={`${fullDay(day)}, ${hourName(hour)}: add event`}
                  onClick={() => onCreate(day, hhmm(hour * 60))}
                  {...grid.cell(index + 1, column)}
                />
              ))}
              {laned.map(({ item, lane, of }) => {
                const style = {
                  top: top(item.start),
                  height: `${((item.end - item.start) / 60) * HOUR_REM}rem`,
                  left: `calc(${(lane / of) * 100}% + 2px)`,
                  width: `calc(${100 / of}% - 4px)`,
                } as CSSProperties;
                return item.kind === "event" ? (
                  <EventChip key={item.key} event={item.event} chips={chips} style={style} timed />
                ) : (
                  <TaskChip key={item.key} task={item.task} chips={chips} style={style} timed />
                );
              })}
              {day === now && <NowLine first={first} />}
              <span className="sr-only">{fullDay(day)}, by the hour</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The moment it is, on today's hours.
function NowLine({ first }: { first: number }) {
  const [minutes, setMinutes] = useState(() => minutesOf(new Date().toISOString()));
  useEffect(() => {
    const timer = setInterval(() => setMinutes(minutesOf(new Date().toISOString())), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (minutes < first * 60) return null;
  return <span className="cal-now" aria-hidden="true" style={{ top: `${((minutes - first * 60) / 60) * HOUR_REM}rem` }} />;
}

// Side by side what overlaps: each piece takes the first lane free at its start, and a run of overlapping pieces shares
// the width between its lanes.
function lanes<T extends { start: number; end: number }>(items: T[]): Array<{ item: T; lane: number; of: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Array<{ item: T; lane: number; of: number }> = [];
  let run: Array<{ item: T; lane: number; of: number }> = [];
  let runEnd = -1;
  let ends: number[] = [];
  const close = () => {
    const of = Math.max(1, ends.length);
    for (const entry of run) entry.of = of;
    out.push(...run);
    run = [];
    ends = [];
  };
  for (const item of sorted) {
    if (item.start >= runEnd && run.length) close();
    let lane = ends.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = ends.length;
      ends.push(item.end);
    } else ends[lane] = item.end;
    run.push({ item, lane, of: 1 });
    runEnd = Math.max(runEnd, item.end);
  }
  close();
  return out;
}

// ---- The week on a narrow screen, and the chosen day under the month: a list of days ---------------------------------

function WeekList({
  days,
  byDay,
  chips,
  dropOn,
  onAdd,
}: {
  days: Day[];
  byDay: Map<Day, { events: CalEvent[]; tasks: TaskData[] }>;
  chips: ChipHandlers;
  dropOn: DropOn;
  onAdd: (day: Day) => void;
}) {
  const now = today();
  return (
    <ol className="cal-list" aria-label="Day by day">
      {days.map((day) => {
        const entry = byDay.get(day);
        const items = (entry?.events.length ?? 0) + (entry?.tasks.length ?? 0);
        return (
          <li key={day} className="cal-list-day" data-day={day} aria-current={day === now ? "date" : undefined} {...dropOn(day)}>
            <div className="cal-list-head">
              <h3 className="t-label">{day === now ? `Today, ${shortDay(day)}` : fullDay(day)}</h3>
              <Button size="sm" variant="quiet" onClick={() => onAdd(day)} aria-label={`Add event on ${fullDay(day)}`}>
                Add event
              </Button>
            </div>
            {items === 0 ? (
              <p className="t-help">Nothing this day.</p>
            ) : (
              <div className="cal-list-items">
                {entry?.events.map((event) => <EventChip key={eventKey(event)} event={event} chips={chips} />)}
                {entry?.tasks.map((task) => <TaskChip key={task.id} task={task} chips={chips} />)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---- The month: its weeks in rows -------------------------------------------------------------------------------------

const MONTH_SHOWN = 4;

function MonthGrid({
  weeks,
  month,
  names,
  byDay,
  chips,
  dropOn,
  onGap,
  onCreate,
  narrow,
  chosen,
  onChoose,
  onMore,
}: {
  weeks: Day[][];
  month: string;
  names: Array<{ short: string; long: string }>;
  byDay: Map<Day, { events: CalEvent[]; tasks: TaskData[] }>;
  chips: ChipHandlers;
  dropOn: DropOn;
  onGap: (event: MouseEvent<HTMLElement>, day: Day, time: string | null) => void;
  // A new event on a day, from the keys.
  onCreate: (day: Day) => void;
  narrow: boolean;
  chosen: Day | null;
  onChoose: (day: Day) => void;
  onMore: (day: Day) => void;
}) {
  const now = today();
  // Entered on today, or on the month's first day when today is not shown.
  const flat = weeks.flat();
  const entry = flat.includes(now) ? flat.indexOf(now) : Math.max(0, flat.findIndex((day) => day.slice(0, 7) === month));
  const grid = useGridKeys({ rows: weeks.length, cols: 7 }, { row: Math.floor(entry / 7), col: entry % 7 });
  const hint = useId();
  return (
    <div
      className="cal-month"
      role="grid"
      aria-label={monthTitle(`${month}-01`)}
      aria-describedby={hint}
      data-narrow={narrow ? "" : undefined}
      onKeyDown={grid.onKeyDown}
      onFocus={grid.onFocus}
    >
      <span id={hint} className="sr-only">
        {narrow ? "The arrows move between days; Enter chooses one." : "The arrows move between days; Enter adds an event on one."}
      </span>
      <div className="cal-month-row cal-month-head" role="row">
        {names.map((name) => (
          <span key={name.long} role="columnheader" className="cal-month-name" aria-label={name.long}>
            {name.short}
          </span>
        ))}
      </div>
      {weeks.map((week, row) => (
        <div key={week[0]} className="cal-month-row" role="row">
          {week.map((day, column) => {
            const entry = byDay.get(day);
            const items: ReactNode[] = [
              ...(entry?.events ?? []).map((event) => <EventChip key={eventKey(event)} event={event} chips={chips} />),
              ...(entry?.tasks ?? []).map((task) => <TaskChip key={task.id} task={task} chips={chips} />),
            ];
            const total = items.length;
            if (narrow) {
              return (
                <div key={day} role="gridcell" className="cal-month-cell" data-outside={day.slice(0, 7) !== month ? "" : undefined} {...dropOn(day)}>
                  <button
                    type="button"
                    className="cal-month-pick"
                    aria-pressed={(chosen ?? now) === day}
                    aria-current={day === now ? "date" : undefined}
                    onClick={() => onChoose(day)}
                    {...grid.cell(row, column)}
                  >
                    {/* The name is what shows —the day's number and what it holds— with the rest said after it. */}
                    <span className="cal-month-num">{Number(day.slice(8))}</span>
                    <span className="sr-only">, {fullDay(day)}: </span>
                    <span className="cal-month-count">{total > 0 ? total : ""}</span>
                    <span className="sr-only">{total === 0 ? "nothing" : new Intl.PluralRules(LOCALE).select(total) === "one" ? " item" : " items"}</span>
                  </button>
                </div>
              );
            }
            const shown = total > MONTH_SHOWN ? items.slice(0, MONTH_SHOWN - 1) : items;
            return (
              <div
                key={day}
                role="gridcell"
                className="cal-month-cell"
                data-day={day}
                data-outside={day.slice(0, 7) !== month ? "" : undefined}
                aria-current={day === now ? "date" : undefined}
                onClick={(event) => onGap(event, day, null)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || !activates(event.key)) return;
                  event.preventDefault();
                  onCreate(day);
                }}
                {...grid.cell(row, column)}
                {...dropOn(day)}
              >
                <span className="cal-month-num">{Number(day.slice(8))}</span>
                <span className="sr-only">, {fullDay(day)}</span>
                <div className="cal-month-items">
                  {shown}
                  {total > shown.length && (
                    <button type="button" className="cal-more" onClick={() => onMore(day)} aria-label={`${total - shown.length} more on ${fullDay(day)}: open its week`}>
                      {total - shown.length} more
                    </button>
                  )}
                </div>
                <span className="cal-add-hint" aria-hidden="true">
                  Add event
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CalendarSkeleton({ view }: { view: View }) {
  return (
    <div className="cal-skeleton" role="status" aria-label="Reading the calendar">
      {Array.from({ length: view === "week" ? 7 : 35 }, (_, i) => (
        <span key={i} className="cal-skeleton-cell">
          <span className="skeleton" />
          <span className="skeleton" />
        </span>
      ))}
    </div>
  );
}

// ---- A dialog of the calendar: native, keeping its content while it leaves ---------------------------------------

function useDialog<T>(value: T | null, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kept, setKept] = useState<T | null>(value);
  if (value !== null && value !== kept) setKept(value);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (value !== null && !dialog.open) dialog.showModal();
    if (value === null && dialog.open) dialog.close();
  }, [value]);
  const props = {
    ref,
    onClose,
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      if (event.target === ref.current) ref.current.dataset.downOutside = "";
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (event.target === ref.current && ref.current.dataset.downOutside !== undefined) onClose();
      if (ref.current) delete ref.current.dataset.downOutside;
    },
  };
  return { ref, kept, props };
}

// ---- A new event: its title, its day and hour, the calendar it goes to, and its place ----------------------------------

const TIMES = [{ value: "all", label: "All day" }, ...Array.from({ length: 48 }, (_, i) => ({ value: hhmm(i * 30), label: timeLabel(hhmm(i * 30)) }))];

function EventComposer({
  draft,
  place,
  tree,
  accounts,
  demoOnly,
  onClose,
}: {
  draft: Draft | null;
  place: string;
  tree: TreeNode[] | null;
  accounts: Account[];
  demoOnly: boolean;
  onClose: () => void;
}) {
  const { notify, touch, saving } = useWorkspace();
  const { ref, kept, props } = useDialog(draft, onClose);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState<Day | null>(draft?.day ?? null);
  const [time, setTime] = useState<string>("all");
  const [calendar, setCalendar] = useState("own");
  const [where, setWhere] = useState<string>(place === ALL ? GENERAL : place);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<Draft | null>(null);
  // Each opening starts from what was pressed: its day, its hour, and the place the page shows.
  if (draft && draft !== seen) {
    setSeen(draft);
    setTitle("");
    setDay(draft.day);
    setTime(draft.time ?? "all");
    setCalendar("own");
    setWhere(place === ALL ? GENERAL : place);
  }
  const calendars = [
    { value: "own", label: OWN_CALENDAR },
    ...accounts.flatMap((account) => account.calendars.filter((entry) => entry.selected).map((entry) => ({ value: `${account.id}|${entry.id}`, label: `${entry.name}, ${account.email}` }))),
  ];
  const places = [{ value: GENERAL, label: "General" }, ...(tree ?? []).map((node) => ({ value: node.id, label: node.path }))];

  async function add() {
    if (!title.trim() || !day || busy) return;
    setBusy(true);
    const when = time === "all" ? { startsOn: day } : { startsAt: new Date(`${day}T${time}:00`).toISOString() };
    const node = where === GENERAL ? null : where;
    if (calendar === "own") {
      const answer = await tool<{ event: { id: string } }>("create_event", { node, title: title.trim(), ...when });
      setBusy(false);
      if (!answer.ok) return notify({ text: `The event could not be added: ${answer.message}`, tone: "error" });
      onClose();
      touch();
      const id = answer.event.id;
      notify({ text: `Added event “${title.trim()}”`, tone: "status", undo: () => void saving(tool("delete_event", { id })) });
      return;
    }
    const [account, calendarId] = calendar.split("|");
    const answer = await tool<{ event: { id: string; accountId: string; calendarId: string } }>("create_google_event", { account, calendar: calendarId, title: title.trim(), ...when });
    if (!answer.ok) {
      setBusy(false);
      return notify({ text: `The event could not be added: ${answer.message}`, tone: "error" });
    }
    if (node) await tool("link_node_event", { node, account, calendar: calendarId, googleEvent: answer.event.id });
    setBusy(false);
    onClose();
    touch();
    const created = answer.event;
    notify({
      text: `Added event “${title.trim()}”`,
      tone: "status",
      undo: () => void saving(tool("delete_google_event", { account: created.accountId, calendar: created.calendarId, event: created.id })),
    });
  }

  return (
    <dialog {...props} className="dialog cal-dialog" aria-labelledby="new-event-title" data-new-event>
      <PopupLayerProvider container={ref}>
        {kept && (
          <form
            className="cal-dialog-in"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <div className="cal-dialog-head">
              <h2 id="new-event-title" className="t-title">
                New event
              </h2>
            </div>
            <label className="cal-field">
              <span className="t-label">Title</span>
              <Field autoFocus name="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Homepage review with the client" maxLength={500} />
            </label>
            <div className="cal-fields">
              <div className="cal-field">
                <span className="t-label">Day</span>
                <DatePicker label="Day" value={day} onChange={setDay} />
              </div>
              <div className="cal-field">
                <span className="t-label">Time</span>
                <Select label="Time" value={time} options={TIMES} onChange={setTime} />
              </div>
            </div>
            <div className="cal-field">
              <span className="t-label">Calendar</span>
              {calendars.length > 1 ? (
                <Select label="Calendar" value={calendar} options={calendars} onChange={setCalendar} />
              ) : (
                <p className="t-value cal-read">{OWN_CALENDAR}</p>
              )}
              {calendars.length === 1 && (
                <p className="t-help">
                  {demoOnly
                    ? "The sample accounts are read only, so the event goes to the workspace's own calendar."
                    : "With a Google account connected, its calendars are offered here too."}
                </p>
              )}
            </div>
            <div className="cal-field">
              <span className="t-label">Place</span>
              <Select label="Place" value={where} options={places} onChange={setWhere} />
            </div>
            <div className="cal-dialog-foot">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!title.trim() || !day || busy}>
                {busy ? "Adding…" : "Add event"}
              </Button>
            </div>
          </form>
        )}
      </PopupLayerProvider>
    </dialog>
  );
}

// ---- An event's detail: when, where, and what is linked to it, with «Link…» to add more ------------------------------

function EventDetail({ event, tree, tasks, onClose }: { event: CalEvent | null; tree: TreeNode[] | null; tasks: TaskData[]; onClose: () => void }) {
  const { notify, touch, saving } = useWorkspace();
  const { ref, kept, props } = useDialog(event, onClose);
  const shown = event ?? kept;
  const [inside, setInside] = useState<{ key: string; items: Item[] | null; error: string | null } | null>(null);
  const [reread, setReread] = useState(0);
  const key = shown ? eventKey(shown) : "";

  useEffect(() => {
    if (!event || event.origin !== "local" || !event.localId) return;
    let live = true;
    void get<{ items: Item[] }>(`/api/events/${event.localId}/tasks`).then((answer) => {
      if (live) setInside({ key: eventKey(event), items: answer.ok ? answer.items : null, error: answer.ok ? null : answer.message });
    });
    return () => {
      live = false;
    };
  }, [event, reread]);

  if (!shown) return <dialog {...props} className="dialog cal-dialog" aria-label="Event" />;
  const items = inside?.key === key ? inside.items : null;
  const linkedNodes = shown.linkedNodeIds.map((id) => tree?.find((node) => node.id === id)).filter((node): node is TreeNode => Boolean(node));
  const target = shown.origin === "local" ? { event: shown.localId } : { account: shown.accountId, calendar: shown.calendarId, googleEvent: shown.id };
  const inEvent = new Set((items ?? []).map((item) => item.id));
  const candidates = tasks.filter((task) => task.status === "open" && !inEvent.has(task.id));
  const nodeCandidates = (tree ?? []).filter((node) => !shown.linkedNodeIds.includes(node.id) && node.id !== shown.nodeId);
  const place = shown.nodePath ?? (shown.origin === "google" ? (tree?.find((node) => node.id === shown.fromNodeId)?.path ?? null) : null);

  async function linkTask(task: TaskData) {
    const answer = await tool("link_task_event", { task: task.id, ...target });
    if (!answer.ok) return notify({ text: `“${inlinePlain(task.title)}” could not be linked: ${answer.message}`, tone: "error" });
    setReread((n) => n + 1);
    touch();
    notify({ text: `Linked “${inlinePlain(task.title)}” to “${shown!.title}”`, tone: "status", undo: () => void saving(tool("unlink_task_event", { task: task.id })) });
  }
  async function unlinkTask(item: Item) {
    const answer = await tool("unlink_task_event", { task: item.id });
    if (!answer.ok) return notify({ text: `“${inlinePlain(item.title)}” could not be taken out: ${answer.message}`, tone: "error" });
    setReread((n) => n + 1);
    touch();
    notify({ text: `Took “${inlinePlain(item.title)}” out of “${shown!.title}”`, tone: "status", undo: () => void saving(tool("link_task_event", { task: item.id, ...target })) });
  }
  async function linkNode(node: TreeNode) {
    const answer = await tool("link_node_event", { node: node.id, ...target });
    if (!answer.ok) return notify({ text: `${node.path} could not be linked: ${answer.message}`, tone: "error" });
    touch();
    notify({ text: `Linked ${node.path} to “${shown!.title}”`, tone: "status", undo: () => void saving(tool("unlink_node_event", { node: node.id, ...target })) });
  }
  async function unlinkNode(node: TreeNode) {
    const answer = await tool("unlink_node_event", { node: node.id, ...target });
    if (!answer.ok) return notify({ text: `${node.path} could not be taken off: ${answer.message}`, tone: "error" });
    touch();
    notify({ text: `Took ${node.path} off “${shown!.title}”`, tone: "status", undo: () => void saving(tool("link_node_event", { node: node.id, ...target })) });
  }
  async function remove() {
    const current = shown!;
    if (current.origin === "local" && current.localId) {
      const id = current.localId;
      const answer = await tool("delete_event", { id });
      if (!answer.ok) return notify({ text: `“${current.title}” could not be deleted: ${answer.message}`, tone: "error" });
      onClose();
      touch();
      notify({ text: `Deleted “${current.title}”`, tone: "status", undo: () => void saving(post(`/api/events/${id}/restore`, {})) });
      return;
    }
    const answer = await tool("delete_google_event", { account: current.accountId, calendar: current.calendarId, event: current.id });
    if (!answer.ok) return notify({ text: `“${current.title}” could not be deleted: ${answer.message}`, tone: "error" });
    onClose();
    touch();
    notify({ text: `Deleted “${current.title}” from its Google calendar`, tone: "status" });
  }

  const linkEntries: MenuEntry[] = [
    {
      kind: "submenu",
      label: "A task",
      entries: candidates.length
        ? candidates.slice(0, 40).map((task): MenuEntry => ({ kind: "action", label: inlinePlain(task.title), detail: task.path ?? "General", onSelect: () => void linkTask(task) }))
        : [{ kind: "action", label: "No open task to link", disabled: true, onSelect: () => undefined }],
    },
    {
      kind: "submenu",
      label: "A client or project",
      entries: nodeCandidates.length
        ? nodeCandidates.map((node): MenuEntry => ({ kind: "action", label: node.path, onSelect: () => void linkNode(node) }))
        : [{ kind: "action", label: "Every client and project is linked", disabled: true, onSelect: () => undefined }],
    },
  ];

  return (
    <dialog {...props} className="dialog cal-dialog" aria-labelledby="event-title" data-event-detail={shown.id}>
      <PopupLayerProvider container={ref}>
        <div className="cal-dialog-in">
          <div className="cal-dialog-head">
            <p className="t-meta cal-dialog-origin">{shown.origin === "local" ? OWN_CALENDAR : `Google calendar, ${shown.accountEmail}`}</p>
            <div className="cal-dialog-tools">
              <Menu label="More" about={`for “${shown.title}”`} entries={[{ kind: "action", label: "Delete", tone: "danger", onSelect: () => void remove() }]} />
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
          <h2 id="event-title" className="t-title cal-event-name" tabIndex={-1}>
            {shown.title}
          </h2>
          <dl className="cal-facts">
            <div>
              <dt className="t-label">When</dt>
              <dd className="t-value">{whenText(shown)}</dd>
            </div>
            <div>
              <dt className="t-label">Place</dt>
              <dd className="t-value">{place ?? "General"}</dd>
            </div>
            {shown.location && (
              <div>
                <dt className="t-label">Location</dt>
                <dd className="t-value">{shown.location}</dd>
              </div>
            )}
          </dl>

          <section className="cal-linked" aria-labelledby="event-linked">
            <div className="cal-linked-head">
              <h3 id="event-linked" className="t-label">
                Linked
              </h3>
              <Menu label="Link…" name={`Link… to “${shown.title}”`} entries={linkEntries} className="cal-link-menu" />
            </div>
            <h4 className="t-meta cal-linked-kind">Tasks and subtasks</h4>
            {shown.origin === "google" ? (
              <p className="t-help">A task linked to a Google event shows it in the task&apos;s own detail.</p>
            ) : items === null ? (
              inside?.key === key && inside.error ? (
                <p className="inline-note" data-tone="alert">
                  The tasks of this event could not be read: {inside.error}
                </p>
              ) : (
                <span className="skeleton" aria-label="Reading the tasks of the event" />
              )
            ) : items.length === 0 ? (
              <p className="t-help">No task is linked yet: &ldquo;Link…&rdquo; puts one in this event.</p>
            ) : (
              <ul className="cal-linked-list">
                {items.map((item) => (
                  <li key={item.id} className="cal-linked-row">
                    <button
                      type="button"
                      className="cal-linked-open"
                      onClick={() => {
                        onClose();
                        openTaskDetail({ id: item.id, task: { id: item.id, title: item.title, nodeId: item.nodeId, path: item.nodePath, parentId: item.parentId, status: item.status, priority: item.priority, dueOn: item.dueOn, dueTime: item.dueTime ?? null } });
                      }}
                    >
                      <span className="t-value">{inlinePlain(item.title)}</span>
                      <span className="t-meta">{item.parentId ? "Subtask" : "Task"}, {item.nodePath ?? "General"}</span>
                    </button>
                    <Button size="sm" variant="quiet" onClick={() => void unlinkTask(item)} aria-label={`Take “${inlinePlain(item.title)}” out of the event`}>
                      Take out
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="t-meta cal-linked-kind">Clients and projects</h4>
            {linkedNodes.length === 0 ? (
              <p className="t-help">No client or project is linked yet.</p>
            ) : (
              <ul className="cal-linked-list">
                {linkedNodes.map((node) => (
                  <li key={node.id} className="cal-linked-row">
                    <span className="t-value cal-linked-node" data-color={node.color ?? undefined}>
                      {node.path}
                    </span>
                    <Button size="sm" variant="quiet" onClick={() => void unlinkNode(node)} aria-label={`Take ${node.path} off the event`}>
                      Take off
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </PopupLayerProvider>
    </dialog>
  );
}
