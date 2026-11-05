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
  type RefObject,
} from "react";
import { BrandMark } from "@/components/brand-mark";
import { GoogleCalendarMark } from "@/components/ui/brands";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { FlipBox } from "@/components/ui/flip-list";
import { ConnectOffer, connectWords, useConnectWay } from "../connect-offer";
import { Fold } from "@/components/ui/fold";
import { AddIcon, NextIcon, PreviousIcon } from "@/components/ui/icons";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { PopupLayerProvider } from "@/components/ui/popup-layer";
import { Select } from "@/components/ui/select";
import { addDays, addMonths, dayOf, firstWeekday, instantsOf, isDay, monthGrid, monthTitle, rangeLabel, today, weekdayNames, weekOf, type Day } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { currentLanguage } from "@/lib/language";
import { PRODUCT_NAME } from "@/lib/product";
import { countedNow, translateNow, useStrings, type StringKey } from "@/lib/strings";
import { BoxFailed } from "../boxes";
import { get, peekGet, peekTool, post, tool, type Answer, type EventsFailure, type Item, type TreeNode } from "../client-api";
import { keptEvents, readEvents, type EventsRead } from "../events-read";
import { PageHeader } from "../page-header";
import { openQuickAdd } from "../quick-add-bus";
import { AccountFilter, accountFromUrl, ALL, branchOf, chosenAccounts, countsByAccount, EVENTS, GENERAL, ITEMS, lineOf, PlaceFilter, placeFromUrl } from "../place-filters";
import { openTaskDetail, TaskCircle, timeLabel, type TaskData } from "../task-row";
import { useSwap } from "../use-swap";
import { cascade } from "./cascade";
import { activates, useGridKeys } from "./grid-keys";
import { holds } from "./holds";
import { useChatScope, useWorkspace } from "../workspace";
import "../../styles/calendar.css";

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
type Loaded = { key: string; view: View; anchor: Day; from: Day; to: Day; events: CalEvent[]; tasks: TaskData[]; failures: EventsFailure[]; waiting: number; accounts: Account[] };

type EmptyDay = "nothing" | "reading" | "unread";
const EMPTY_DAY: Record<EmptyDay, StringKey> = { nothing: "calPage.emptyNothing", reading: "calPage.emptyReading", unread: "calPage.emptyUnread" };
const EMPTY_MONTH_DAY: Record<EmptyDay, StringKey> = { nothing: "calPage.monthNothing", reading: "calPage.monthReading", unread: "calPage.monthUnread" };
type View = "week" | "month";
type Draft = { day: Day; time: string | null };

const ownCalendar = () => translateNow("calPage.ownCalendar", { product: PRODUCT_NAME });
const BAND_PIECES = 2;
const folds = (count: number) => count > BAND_PIECES + 1;

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <Calendar />
    </Suspense>
  );
}

function loadedOf(key: string, view: View, anchor: Day, range: { from: Day; to: Day }, events: EventsRead<CalEvent>, tasks: TasksAnswer, accounts: Answer<{ accounts: Account[] }>): Loaded {
  return {
    key,
    view,
    anchor,
    from: range.from,
    to: range.to,
    events: events.events,
    tasks: [...tasks.groups.overdue.tasks, ...tasks.groups.today.tasks, ...tasks.groups.upcoming.days.flatMap((day) => day.tasks), ...(tasks.completed?.tasks ?? [])],
    failures: events.failures,
    waiting: events.waiting,
    accounts: accounts.ok ? accounts.accounts : [],
  };
}

function keptLoaded(key: string, view: View, anchor: Day, range: { from: Day; to: Day }): Loaded | null {
  const instants = instantsOf(range.from, range.to);
  const events = keptEvents<CalEvent>({ from: instants.from, to: instants.to, fromDay: range.from, toDay: range.to });
  const tasks = peekTool<TasksAnswer>("get_tasks", { today: today(), withCompleted: true });
  const accounts = peekGet<{ accounts: Account[] }>("/api/accounts");
  return events && tasks && accounts ? loadedOf(key, view, anchor, range, events.value, tasks.value, accounts.value) : null;
}

const eventKey = (event: CalEvent) => `${event.origin}:${event.accountId}:${event.calendarId}:${event.id}`;
const ofChosen = (event: CalEvent, some: Set<string> | null) => some === null || (event.origin === "google" && some.has(event.accountId));

function daysOf(event: CalEvent): Day[] {
  const first = event.allDay ? event.start.slice(0, 10) : dayOf(new Date(event.start));
  const last = event.allDay ? event.end.slice(0, 10) : dayOf(new Date(Date.parse(event.end) - 1));
  const days: Day[] = [];
  for (let day = first; day <= last && days.length < 62; day = addDays(day, 1)) days.push(day);
  return days.length ? days : [first];
}

const onHours = (event: CalEvent) => !event.allDay && daysOf(event).length === 1;
const localeNow = () => (typeof document === "undefined" ? "en" : currentLanguage());
const clock = (iso: string) => new Date(iso).toLocaleTimeString(localeNow(), { hour: "numeric", minute: "2-digit" });
const minutesOf = (iso: string) => {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
};
const DAY_MINUTES = 24 * 60;
const endOf = (event: CalEvent) => {
  const minutes = minutesOf(event.end);
  return minutes === 0 && Date.parse(event.end) > Date.parse(event.start) ? DAY_MINUTES : minutes;
};
const pieceEnd = (start: number, end = start) => Math.min(DAY_MINUTES, Math.max(end, start + 30));
const minutesOfDay = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fullDay = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(localeNow(), { weekday: "long", month: "long", day: "numeric" }).format(new Date(y, m - 1, d));
};
const shortDay = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(localeNow(), { weekday: "short", month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
};
const hourName = (hour: number) => new Intl.DateTimeFormat(localeNow(), { hour: "numeric" }).format(new Date(2000, 0, 1, hour));

function whenText(event: CalEvent): string {
  const days = daysOf(event);
  if (event.allDay) return days.length > 1 ? translateNow("calPage.allDayRange", { from: shortDay(days[0]), to: shortDay(days.at(-1)!) }) : translateNow("calPage.allDayWhen", { day: shortDay(days[0]) });
  return days.length > 1
    ? translateNow("calPage.timedRange", { from: shortDay(days[0]), start: clock(event.start), to: shortDay(days.at(-1)!), end: clock(event.end) })
    : translateNow("calPage.timedSame", { day: shortDay(days[0]), start: clock(event.start), end: clock(event.end) });
}

const NARROW_REM = 52;
function useNarrow(card: RefObject<HTMLElement | null>, mounted: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = card.current;
    if (!mounted || !element) return;
    const observer = new ResizeObserver(() => {
      setNarrow(element.clientWidth / parseFloat(getComputedStyle(document.documentElement).fontSize) < NARROW_REM);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [card, mounted]);
  return narrow;
}
const noSubscription = () => () => {};

const onFreeSpace = (event: MouseEvent<HTMLElement>) => !(event.target as Element).closest("button, a, [draggable='true'], [role='menu']");

function Calendar() {
  const { t, counted } = useStrings();
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const card = useRef<HTMLElement>(null);
  const narrow = useNarrow(card, mounted);
  const { version, tree, notify, touch, saving, mailAccounts } = useWorkspace();
  const connectWay = useConnectWay();
  const noAccounts = mailAccounts !== null && mailAccounts.length === 0;
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
  const [loaded, setLoaded] = useState<Loaded | null>(() => keptLoaded(rangeKey, view, anchor, range));
  const [keptFor, setKeptFor] = useState(rangeKey);
  if (keptFor !== rangeKey) {
    setKeptFor(rangeKey);
    const kept = keptLoaded(rangeKey, view, anchor, range);
    if (kept) setLoaded(kept);
  }
  const [readError, setReadError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [chosenDay, setChosenDay] = useState<Day | null>(null);
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
    const beside = Promise.all([tool<TasksAnswer>("get_tasks", { today: today(), withCompleted: true }), get<{ accounts: Account[] }>("/api/accounts")]);
    const made = (events: EventsRead<CalEvent>, tasks: TasksAnswer, accounts: Answer<{ accounts: Account[] }>) => loadedOf(rangeKey, view, anchor, range, events, tasks, accounts);
    void Promise.all([
      readEvents<CalEvent>(
        { from: instants.from, to: instants.to, fromDay: range.from, toDay: range.to },
        {
          onArrived: (events) =>
            void beside.then(([tasks, accounts]) => {
              if (!live || !tasks.ok) return;
              setLoaded((now) => (now?.key === rangeKey && now.waiting === 0 ? now : made(events, tasks, accounts)));
              setReadError(null);
            }),
        },
      ),
      beside,
    ]).then(([events, [tasks, accounts]]) => {
      if (!live) return;
      if (!events.ok || !tasks.ok) {
        setReadError(!events.ok ? events.message : !tasks.ok ? tasks.message : "");
        return;
      }
      setReadError(null);
      setMoved(new Map());
      setLoaded(made(events, tasks, accounts));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, rangeKey, version, round]);

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

  const shownFrom = loaded?.from ?? range.from;
  const shownTo = loaded?.to ?? range.to;
  const inRange = (day: string | null) => Boolean(day && day >= shownFrom && day <= shownTo);
  const tasksAll = useMemo(() => (loaded?.tasks ?? []).map((task) => (moved.has(task.id) ? { ...task, dueOn: moved.get(task.id)! } : task)), [loaded, moved]);
  const placeEvents = useMemo(() => (loaded?.events ?? []).filter((event) => byPlace.eventIn(event, place)), [loaded, byPlace, place]);
  const account = accountFromUrl(accountParam, loaded?.accounts ?? [], tree);
  const chosen = useMemo(() => chosenAccounts(account, loaded?.accounts ?? [], tree), [account, loaded, tree]);
  const events = useMemo(() => placeEvents.filter((event) => ofChosen(event, chosen)), [placeEvents, chosen]);
  const tasks = useMemo(
    () => tasksAll.filter((task) => Boolean(task.dueOn && task.dueOn >= shownFrom && task.dueOn <= shownTo) && byPlace.taskIn(task, place)),
    [tasksAll, shownFrom, shownTo, byPlace, place],
  );

  const placeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const eventsOfAccount = (loaded?.events ?? []).filter((event) => ofChosen(event, chosen));
    const rangeTasks = tasksAll.filter((task) => inRange(task.dueOn));
    for (const where of [ALL, GENERAL, ...(tree ?? []).map((node) => node.id)]) {
      counts.set(where, eventsOfAccount.filter((event) => byPlace.eventIn(event, where)).length + rangeTasks.filter((task) => byPlace.taskIn(task, where)).length);
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tasksAll, tree, chosen, byPlace]);
  const accountCounts = countsByAccount(loaded?.accounts ?? [], tree, (some) => placeEvents.filter((event) => event.origin === "google" && ofChosen(event, some)).length);

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

  const model = useMemo(
    () => (loaded ? { byDay, view: loaded.view, anchor: loaded.anchor, from: loaded.from, to: loaded.to } : null),
    [byDay, loaded],
  );
  const swap = useSwap(model, loaded?.key ?? "none");
  const shown = swap.shown;
  const stale = Boolean(loaded && loaded.key !== rangeKey);
  const unanswered = loaded?.waiting ?? 0;
  const reading = readError === null && unanswered > 0;
  const emptyDay: EmptyDay = unanswered === 0 ? "nothing" : reading ? "reading" : "unread";

  const step = (direction: 1 | -1) => set({ date: view === "month" ? addMonths(anchor, direction) : addDays(anchor, 7 * direction) });
  const writable = (loaded?.accounts ?? []).filter((entry) => !entry.isDemo && entry.status === "active");
  const todayDay = today();
  const isCurrent = view === "week" ? todayDay >= range.from && todayDay <= range.to : todayDay.slice(0, 7) === anchor.slice(0, 7);
  const title = view === "month" ? monthTitle(anchor) : rangeLabel(range.from, range.to);
  const selectedEvent = openEvent ? ((loaded?.events ?? []).find((event) => eventKey(event) === openEvent) ?? null) : null;

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
      return notify({ text: translateNow("row.couldNotMove", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
    }
    touch();
    notify({
      text: translateNow("calPage.movedToDay", { title: inlinePlain(task.title), day: shortDay(day) }),
      tone: "status",
      undo: () => void saving(tool("update_item", { id: task.id, dueOn: from })),
    });
    if (keepFocus) focusTask(task.id);
  }

  function focusTask(id: string) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cal-task="${id}"] .cal-task-open`)?.focus({ preventScroll: false })),
    );
  }

  function onTaskKey(event: KeyboardEvent<HTMLElement>, task: TaskData) {
    if (!event.altKey || !task.dueOn) return;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const day = addDays(task.dueOn, offset);
    void moveTask(task, day, true);
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

  function onGap(event: MouseEvent<HTMLElement>, day: Day, time: string | null) {
    if (onFreeSpace(event)) setDraft({ day, time });
  }
  const addTask = (day: Day) => openQuickAdd(place === ALL ? { day } : { day, placeId: place === GENERAL ? null : place });

  if (!mounted) return null;
  const countedLine = t("calPage.countLine", { events: counted(events.length, "counted.event", "counted.events"), tasks: counted(tasks.length, "counted.task", "counted.tasks") });
  const filteredBy = [place === ALL ? null : t("calPage.clientOrProjectWord"), account === ALL ? null : t("calPage.accountWord")].filter(Boolean);
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page cal-page" data-calendar={view}>
        <PageHeader
          title={t("calPage.title")}
          count={loaded ? `${[countedLine, reading ? t("calPage.stillReading", { what: counted(unanswered, "counted.account", "counted.accounts") }) : null].filter(Boolean).join(", ")}.` : readError === null ? t("calPage.loading") : t("calPage.eventsAndTasks")}
          filters={
            <>
              <PlaceFilter value={place} tree={tree} counts={placeCounts} unit={ITEMS} onChange={(value) => set({ place: value === ALL ? null : value })} />
              <AccountFilter
                value={account}
                accounts={loaded?.accounts ?? []}
                tree={tree}
                counts={loaded ? accountCounts : null}
                unit={EVENTS}
                onChange={(value) => set({ account: value === ALL ? null : value })}
              />
            </>
          }
          filtersSet={(place === ALL ? 0 : 1) + (account === ALL ? 0 : 1)}
          views={{ label: t("common.view"), value: view, options: [{ value: "week", label: t("calPage.week") }, { value: "month", label: t("calPage.month") }], onChange: (value) => set({ view: value === "week" ? null : value }) }}
          chat
        />

        <section ref={card} className="card cal-card" aria-labelledby="cal-range" aria-busy={reading || (readError === null && (!loaded || loaded.key !== rangeKey))}>
          <div className="cal-bar">
            <h2 id="cal-range" className="t-title cal-range" aria-live="polite">
              {title}
            </h2>
            <div className="cal-steps" role="group" aria-label={t("calPage.moveThrough")}>
              <div className="btn-group">
                <Button size="sm" className="btn-icon" onClick={() => step(-1)} title={t("calPage.previous")}>
                  <PreviousIcon />
                  <span className="sr-only">{t("calPage.previous")}</span>
                </Button>
                <Button size="sm" onClick={() => set({ date: null })} disabled={isCurrent} aria-label={view === "week" ? t("calPage.todayWeek") : t("calPage.todayMonth")}>
                  {t("date.today")}
                </Button>
                <Button size="sm" className="btn-icon" onClick={() => step(1)} title={t("calPage.next")}>
                  <NextIcon />
                  <span className="sr-only">{t("calPage.next")}</span>
                </Button>
              </div>
              <Button size="sm" variant="primary" onClick={() => setDraft({ day: chosenDay ?? (isCurrent ? todayDay : range.from), time: null })}>
                <AddIcon />
                <span className="btn-label">{t("calPage.newEvent")}</span>
              </Button>
            </div>
          </div>

          {readError && shown && (
            <p role="alert" className="inline-note" data-tone="alert">
              {t("calPage.notLoadedAgain", { message: readError })}
            </p>
          )}
          {loaded?.failures.filter((failure) => !loaded.accounts.some((entry) => entry.id === failure.accountId && entry.isDemo)).map((failure) => (
            <p key={failure.accountId || "accounts"} role="alert" className="inline-note" data-tone="alert">
              {failure.accountEmail ? t("calPage.accountCalendarFailed", { email: failure.accountEmail, reason: failure.reason }) : t("calPage.someCalendarsFailed", { reason: failure.reason })}
            </p>
          ))}

          {!shown && readError ? (
            <BoxFailed what={t("cal.theCalendar")} message={readError} kept={false} onRetry={() => setRound((value) => value + 1)} />
          ) : !shown ? (
            <CalendarSkeleton view={view} />
          ) : (
            <div className="cal-body" data-leaving={swap.leaving ? "" : undefined} data-stale={stale ? "" : undefined} data-cal-body={swap.shownKey}>
              {shown.view === "week" ? (
                narrow ? (
                  <WeekList days={daysBetween(shown.from, shown.to)} byDay={shown.byDay} chips={chipProps} dropOn={dropOn} onAdd={(day) => setDraft({ day, time: null })} emptyDay={emptyDay} />
                ) : (
                  <WeekGrid days={daysBetween(shown.from, shown.to)} byDay={shown.byDay} chips={chipProps} dropOn={dropOn} onCreate={(day, time) => setDraft({ day, time })} onAddTask={addTask} />
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
                  emptyDay={emptyDay}
                />
              )}
              {shown.view === "month" && narrow && (
                <WeekList
                  days={[chosenDay && chosenDay.slice(0, 7) === shown.anchor.slice(0, 7) ? chosenDay : todayDay.slice(0, 7) === shown.anchor.slice(0, 7) ? todayDay : `${shown.anchor.slice(0, 7)}-01`]}
                  byDay={shown.byDay}
                  chips={chipProps}
                  dropOn={dropOn}
                  onAdd={(day) => setDraft({ day, time: null })}
                  emptyDay={emptyDay}
                  counted
                />
              )}
              {!stale && unanswered === 0 && events.length === 0 && tasks.length === 0 && (
                <div className="cal-empty">
                  <p className="t-help">
                    {`${view === "week" ? t("calPage.nothingWeek") : t("calPage.nothingMonth")}${filteredBy.length ? t("calPage.forChosen", { what: filteredBy.join(t("calPage.andJoin")) }) : ""}.`}
                    {noAccounts && ` ${connectWords(connectWay, t("connect.itsEvents"))}`}
                  </p>
                  {noAccounts && <ConnectOffer way={connectWay} />}
                </div>
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
          sample={Boolean(selectedEvent && loaded?.accounts.some((entry) => entry.isDemo && entry.id === selectedEvent.accountId))}
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

function nodeColor(tree: TreeNode[] | null, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return tree?.find((node) => node.id === id)?.color ?? undefined;
}

function EventChip({ event, chips, style, timed, minutes, lead, flipKey }: { event: CalEvent; chips: ChipHandlers; style?: CSSProperties; timed?: boolean; minutes?: number; lead?: boolean; flipKey?: string }) {
  const { tree } = useWorkspace();
  const color = nodeColor(tree, event.nodeId ?? event.linkedNodeIds[0] ?? event.fromNodeId);
  const moment = <span className="cal-event-when">{event.allDay ? translateNow("calPage.allDay") : clock(event.start)}</span>;
  return (
    <button
      type="button"
      className="cal-event"
      data-color={color}
      data-timed={timed ? "" : undefined}
      data-short={timed && (minutes ?? 0) < 60 ? "" : undefined}
      data-origin={event.origin}
      style={style}
      title={event.title}
      onClick={() => chips.onOpenEvent(event)}
      data-cal-event={event.id}
      data-flip-key={flipKey}
    >
      {lead && moment}
      <span className="cal-event-title">{event.title}</span>
      {!lead && !event.allDay && moment}
      <span className="sr-only">{translateNow("calPage.eventSr", { when: whenText(event) })}</span>
    </button>
  );
}

function TaskChip({ task, chips, style, timed, lead }: { task: TaskData; chips: ChipHandlers; style?: CSSProperties; timed?: boolean; lead?: boolean }) {
  const [done, setDone] = useState(task.status === "done");
  const { notify, touch, saving } = useWorkspace();
  const fine = useSyncExternalStore(subscribeFine, () => window.matchMedia("(pointer: fine)").matches, () => false);
  async function toggle() {
    const next = !done;
    setDone(next);
    const answer = await tool("update_item", { id: task.id, status: next ? "done" : "open" });
    if (!answer.ok) {
      setDone(!next);
      return notify({ text: translateNow("calPage.couldNotChange", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
    }
    touch();
    notify({
      text: next ? translateNow("row.completed", { title: inlinePlain(task.title) }) : translateNow("row.reopened", { title: inlinePlain(task.title) }),
      tone: "status",
      undo: () => void saving(tool("update_item", { id: task.id, status: next ? "open" : "done" })),
    });
  }
  const hour = task.dueTime ? timeLabel(task.dueTime) : null;
  const plain = inlinePlain(task.title);
  const hourShown = !timed && !lead && hour;
  return (
    <div
      className="cal-task"
      data-cal-task={task.id}
      data-flip-key={`task:${task.id}`}
      data-color={task.color ?? undefined}
      data-done={done ? "" : undefined}
      data-timed={timed ? "" : undefined}
      style={style}
      draggable={fine && task.status === "open"}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", plain);
        event.dataTransfer.effectAllowed = "move";
        chips.onDragStart(task);
      }}
      onDragEnd={chips.onDragEnd}
    >
      {lead && <span className="cal-task-when">{hour}</span>}
      <TaskCircle title={task.title} priority={task.priority} done={done} onToggle={() => void toggle()} className="cal-task-circle" />
      <button
        type="button"
        className="cal-task-open"
        title={hour ? `${plain}, ${hour}` : plain}
        onClick={() => openTaskDetail({ id: task.id, task, list: chips.list })}
        onKeyDown={(event) => chips.onTaskKey(event, task)}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
      >
        <span className="cal-task-title">{plain}</span>
        {hourShown && <span className="cal-task-when">{hour}</span>}
        <span className="sr-only">
          {translateNow("calPage.taskSr", { at: hour && !hourShown ? translateNow("calPage.taskAt", { hour }) : "" })}
        </span>
      </button>
    </div>
  );
}

function subscribeFine(onChange: () => void) {
  const query = window.matchMedia("(pointer: fine)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const HOUR_REM = 3;
const LINE_MINUTES = Math.ceil((1.5 / HOUR_REM) * 60);
const remOf = (minutes: number) => `${(minutes / 60) * HOUR_REM}rem`;

function titleLines(minutes: number): number {
  const lines = Math.max(1, Math.floor(((minutes / 60) * HOUR_REM - 0.4) / 1.06));
  return lines <= 2 ? lines : lines - 1;
}

function WeekGrid({
  days,
  byDay,
  chips,
  dropOn,
  onCreate,
  onAddTask,
}: {
  days: Day[];
  byDay: Map<Day, { events: CalEvent[]; tasks: TaskData[] }>;
  chips: ChipHandlers;
  dropOn: DropOn;
  onCreate: (day: Day, time: string | null) => void;
  onAddTask: (day: Day) => void;
}) {
  const now = today();
  let first = 8;
  let last = 19;
  for (const day of days) {
    const entry = byDay.get(day);
    for (const event of entry?.events ?? []) {
      if (!onHours(event)) continue;
      first = Math.min(first, Math.floor(minutesOf(event.start) / 60));
      last = Math.max(last, Math.ceil(pieceEnd(minutesOf(event.start), endOf(event)) / 60) - 1);
    }
    for (const task of entry?.tasks ?? []) {
      if (!task.dueTime) continue;
      const start = minutesOfDay(task.dueTime);
      first = Math.min(first, Math.floor(start / 60));
      last = Math.max(last, Math.ceil(Math.min(DAY_MINUTES, start + LINE_MINUTES) / 60) - 1);
    }
  }
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const top = (minutes: number) => remOf(minutes - first * 60);
  const withTasks = days.some((day) => byDay.get(day)?.tasks.some((task) => !task.dueTime));
  const firstHourRow = withTasks ? 2 : 1;
  const grid = useGridKeys({ rows: hours.length + firstHourRow, cols: days.length }, { row: 0, col: Math.max(0, days.indexOf(now)) });
  const hint = useId();

  return (
    <div
      className="cal-week"
      role="grid"
      aria-label={translateNow("calPage.theWeek")}
      aria-describedby={hint}
      style={{ "--days": days.length } as CSSProperties}
      onKeyDown={grid.onKeyDown}
      onFocus={grid.onFocus}
    >
      <span id={hint} className="sr-only">
        {translateNow("calPage.weekHint")}
      </span>
      <div className="cal-week-row cal-week-head" role="row">
        <span className="cal-gutter" aria-hidden="true" />
        {days.map((day) => (
          <div key={day} role="columnheader" className="cal-week-day" aria-current={day === now ? "date" : undefined}>
            <span className="cal-week-name">{new Intl.DateTimeFormat(localeNow(), { weekday: "short" }).format(new Date(`${day}T12:00:00`))}</span>
            <span className="cal-week-num">{Number(day.slice(8))}</span>
          </div>
        ))}
      </div>
      <WeekBand
        label={translateNow("calPage.allDay")}
        about={translateNow("calPage.aboutAllDay")}
        hint={translateNow("calPage.addEvent")}
        days={days}
        row={0}
        grid={grid}
        dropOn={dropOn}
        onAdd={(day) => onCreate(day, null)}
        pieces={(day) => (byDay.get(day)?.events ?? []).filter((event) => !onHours(event)).map((event) => <EventChip key={eventKey(event)} event={event} chips={chips} flipKey={`${day}:${eventKey(event)}`} />)}
      />
      {withTasks && (
        <WeekBand
          label={translateNow("calPage.tasksBand")}
          about={translateNow("calPage.aboutTasksNoHour")}
          hint={translateNow("calPage.addTask")}
          days={days}
          row={1}
          grid={grid}
          dropOn={dropOn}
          onAdd={onAddTask}
          pieces={(day) => (byDay.get(day)?.tasks ?? []).filter((task) => !task.dueTime).map((task) => <TaskChip key={task.id} task={task} chips={chips} />)}
        />
      )}
      <div className="cal-week-row cal-hours" role="row" style={{ "--hours": hours.length, "--hour": `${HOUR_REM}rem` } as CSSProperties}>
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
            ...(entry?.events ?? []).filter(onHours).map((event) => ({ kind: "event" as const, key: eventKey(event), start: minutesOf(event.start), end: pieceEnd(minutesOf(event.start), endOf(event)), event })),
            ...(entry?.tasks ?? []).filter((task) => task.dueTime).map((task) => {
              const start = minutesOfDay(task.dueTime!);
              return { kind: "task" as const, key: task.id, start, end: Math.min(DAY_MINUTES, start + LINE_MINUTES), above: true, task };
            }),
          ];
          const placed = cascade(timed, LINE_MINUTES);
          return (
            <FlipBox key={day} share="week" role="gridcell" className="cal-day-hours" data-day={day} data-today={day === now ? "" : undefined} {...dropOn(day)}>
              {hours.map((hour, index) => (
                <button
                  key={hour}
                  type="button"
                  className="cal-hour-slot"
                  style={{ top: top(hour * 60) }}
                  aria-label={translateNow("calPage.addEventOn", { day: fullDay(day), hour: hourName(hour) })}
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    onCreate(day, hhmm(hour * 60 + (event.detail > 0 && event.clientY - box.top >= box.height / 2 ? 30 : 0)));
                  }}
                  {...grid.cell(index + firstHourRow, column)}
                >
                  <span className="cal-add-hint" aria-hidden="true">
                    {translateNow("calPage.addEvent")}
                  </span>
                </button>
              ))}
              {placed.map(({ item, inset, layer, textAt, room, clip }) => {
                const minutes = item.end - item.start;
                const place = {
                  left: `calc(${inset * 100}% + 2px)`,
                  width: `calc(${(1 - inset) * 100}% - 4px)`,
                  zIndex: 1 + layer,
                  ...(clip < 1 && { "--clip": clip }),
                };
                if (item.kind === "task") {
                  const style = { ...place, top: top(Math.min(item.start, DAY_MINUTES - LINE_MINUTES)) } as CSSProperties;
                  return <TaskChip key={item.key} task={item.task} chips={chips} style={style} timed />;
                }
                const style = {
                  ...place,
                  top: top(item.start),
                  height: remOf(minutes),
                  "--title-lines": titleLines(room),
                  "--text-at": remOf(textAt),
                  "--text-below": remOf(minutes - textAt - room),
                } as CSSProperties;
                return <EventChip key={item.key} event={item.event} chips={chips} style={style} timed minutes={minutes} flipKey={`${day}:${item.key}`} />;
              })}
              {day === now && <NowLine first={first} last={last} />}
              <span className="sr-only">{translateNow("calPage.byHour", { day: fullDay(day) })}</span>
            </FlipBox>
          );
        })}
      </div>
    </div>
  );
}

function WeekBand({
  label,
  about,
  hint,
  days,
  row,
  grid,
  dropOn,
  onAdd,
  pieces,
}: {
  label: string;
  about: string;
  hint: string;
  days: Day[];
  row: number;
  grid: ReturnType<typeof useGridKeys>;
  dropOn: DropOn;
  onAdd: (day: Day) => void;
  pieces: (day: Day) => ReactNode[];
}) {
  const now = today();
  const id = useId();
  const [open, setOpen] = useState<ReadonlySet<Day>>(new Set());
  const toggle = (day: Day) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(day)) next.add(day);
      return next;
    });
  const all = days.map(pieces);
  const lines = all.map((list, index) => (!folds(list.length) ? list.length : (open.has(days[index]) ? list.length : BAND_PIECES) + 1));
  const tallest = Math.max(...lines);
  return (
    <div className="cal-week-row cal-band" role="row">
      <span className="cal-gutter t-meta">{label}</span>
      {days.map((day, column) => {
        const rest = folds(all[column].length) ? all[column].length - BAND_PIECES : 0;
        const unfolded = open.has(day);
        return (
          <FlipBox
            key={day}
            share="week"
            layout="list"
            role="gridcell"
            className="cal-slot"
            data-day={day}
            data-today={day === now ? "" : undefined}
            onClick={(event) => {
              if (onFreeSpace(event)) onAdd(day);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || !activates(event.key)) return;
              event.preventDefault();
              onAdd(day);
            }}
            {...grid.cell(row, column)}
            {...dropOn(day)}
          >
            {rest > 0 ? all[column].slice(0, BAND_PIECES) : all[column]}
            {rest > 0 && (
              <>
                <Fold open={unfolded} id={`${id}${day}`}>
                  <div className="cal-band-rest">{all[column].slice(BAND_PIECES)}</div>
                </Fold>
                <button
                  type="button"
                  className="cal-more"
                  aria-expanded={unfolded}
                  aria-controls={`${id}${day}`}
                  aria-label={unfolded ? translateNow("calPage.showLessOn", { day: fullDay(day) }) : translateNow("calPage.moreOn", { n: rest, day: fullDay(day) })}
                  onClick={() => toggle(day)}
                >
                  {unfolded ? translateNow("tasks.showLess") : translateNow("calPage.moreCount", { n: rest })}
                </button>
              </>
            )}
            <span className="sr-only">
              {fullDay(day)}, {about}
            </span>
            {(lines[column] === 0 || lines[column] < tallest) && (
              <span className="cal-add-hint" aria-hidden="true">
                {hint}
              </span>
            )}
          </FlipBox>
        );
      })}
    </div>
  );
}

function NowLine({ first, last }: { first: number; last: number }) {
  const [minutes, setMinutes] = useState(() => minutesOf(new Date().toISOString()));
  useEffect(() => {
    const timer = setInterval(() => setMinutes(minutesOf(new Date().toISOString())), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (minutes < first * 60 || minutes >= (last + 1) * 60) return null;
  return <span className="cal-now" aria-hidden="true" style={{ top: remOf(minutes - first * 60) }} />;
}

function WeekList({
  days,
  byDay,
  chips,
  dropOn,
  onAdd,
  emptyDay,
  counted = false,
}: {
  days: Day[];
  byDay: Map<Day, { events: CalEvent[]; tasks: TaskData[] }>;
  chips: ChipHandlers;
  dropOn: DropOn;
  onAdd: (day: Day) => void;
  emptyDay: EmptyDay;
  counted?: boolean;
}) {
  const now = today();
  return (
    <ol className="cal-list" aria-label={translateNow("calPage.dayByDay")}>
      {days.map((day) => {
        const events = byDay.get(day)?.events ?? [];
        const tasks = byDay.get(day)?.tasks ?? [];
        const empty = events.length === 0 && tasks.length === 0;
        const onClock = [
          ...events.filter(onHours).map((event) => ({ at: minutesOf(event.start), piece: <EventChip key={eventKey(event)} event={event} chips={chips} lead /> })),
          ...tasks.filter((task) => task.dueTime).map((task) => ({ at: minutesOfDay(task.dueTime!), piece: <TaskChip key={task.id} task={task} chips={chips} lead /> })),
        ].sort((a, b) => a.at - b.at);
        return (
          <li key={day} className="cal-list-day" data-day={day} data-empty={empty ? "" : undefined} aria-current={day === now ? "date" : undefined} {...dropOn(day)}>
            <div className="cal-list-head">
              <h3 className="t-label">
                {day === now ? translateNow("calPage.todayFull", { day: fullDay(day) }) : fullDay(day)}
                {counted && !empty && (
                  <>
                    <span className="sr-only">, </span>
                    <span className="t-meta cal-list-count">{holds(events.length, tasks.length)}</span>
                  </>
                )}
              </h3>
              <Button size="sm" variant="quiet" onClick={() => onAdd(day)} aria-label={translateNow("calPage.addEventOnDay", { day: fullDay(day) })}>
                {translateNow("calPage.addEvent")}
              </Button>
            </div>
            {empty ? (
              <p className="t-help">{translateNow(EMPTY_DAY[emptyDay])}</p>
            ) : (
              <div className="cal-list-items">
                {events.filter((event) => !onHours(event)).map((event) => <EventChip key={eventKey(event)} event={event} chips={chips} lead />)}
                {onClock.map((entry) => entry.piece)}
                {tasks.filter((task) => !task.dueTime).map((task) => <TaskChip key={task.id} task={task} chips={chips} lead />)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

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
  emptyDay,
}: {
  weeks: Day[][];
  month: string;
  names: Array<{ short: string; long: string }>;
  byDay: Map<Day, { events: CalEvent[]; tasks: TaskData[] }>;
  chips: ChipHandlers;
  dropOn: DropOn;
  onGap: (event: MouseEvent<HTMLElement>, day: Day, time: string | null) => void;
  onCreate: (day: Day) => void;
  narrow: boolean;
  chosen: Day | null;
  onChoose: (day: Day) => void;
  onMore: (day: Day) => void;
  emptyDay: EmptyDay;
}) {
  const now = today();
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
        {narrow ? translateNow("calPage.monthHintNarrow") : translateNow("calPage.monthHint")}
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
                    <span className="cal-month-num">{Number(day.slice(8))}</span>
                    <span className="sr-only">, {fullDay(day)}: </span>
                    <span className="cal-month-count">{total > 0 ? total : null}</span>
                    <span className="sr-only">{total > 0 ? ` ${countedNow(total, "counted.item", "counted.items").replace(/^\d+ /, "")}` : translateNow(EMPTY_MONTH_DAY[emptyDay])}</span>
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
                    <button type="button" className="cal-more" onClick={() => onMore(day)} aria-label={translateNow("calPage.moreOnOpen", { n: total - shown.length, day: fullDay(day) })}>
                      {translateNow("calPage.moreCount", { n: total - shown.length })}
                    </button>
                  )}
                </div>
                <span className="cal-add-hint" aria-hidden="true">
                  {translateNow("calPage.addEvent")}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const WAITING_EVENTS = [2, 1, 3, 1, 2, 0, 1];

function CalendarSkeleton({ view }: { view: View }) {
  return (
    <div className="cal-skeleton" data-view={view} role="status" aria-label={translateNow("calPage.loadingCalendar")}>
      <div className="cal-skeleton-in" aria-hidden="true">
        <span className="cal-skeleton-head">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="skeleton" />
          ))}
        </span>
        {Array.from({ length: view === "month" ? 35 : 7 }, (_, i) => (
          <span key={i} className="cal-skeleton-cell">
            <span className="skeleton cal-skeleton-day" />
            {Array.from({ length: view === "month" ? WAITING_EVENTS[(i * 3) % 7] % 3 : Math.max(1, WAITING_EVENTS[i]) }, (_, e) => (
              <span key={e} className="skeleton cal-skeleton-event" />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

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

const times = () => [{ value: "all", label: translateNow("calPage.allDay") }, ...Array.from({ length: 48 }, (_, i) => ({ value: hhmm(i * 30), label: timeLabel(hhmm(i * 30)) }))];

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
  const { t, lang } = useStrings();
  const { notify, touch, saving } = useWorkspace();
  const { ref, kept, props } = useDialog(draft, onClose);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState<Day | null>(draft?.day ?? null);
  const [time, setTime] = useState<string>("all");
  const [calendar, setCalendar] = useState("own");
  const [where, setWhere] = useState<string>(place === ALL ? GENERAL : place);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<Draft | null>(null);
  if (draft && draft !== seen) {
    setSeen(draft);
    setTitle("");
    setDay(draft.day);
    setTime(draft.time ?? "all");
    setCalendar("own");
    setWhere(place === ALL ? GENERAL : place);
  }
  const calendars = [
    { value: "own", label: ownCalendar(), mark: BrandMark },
    ...accounts.flatMap((account) =>
      account.calendars.filter((entry) => entry.selected).map((entry) => ({ value: `${account.id}|${entry.id}`, label: `${entry.name}, ${account.email}`, mark: GoogleCalendarMark })),
    ),
  ];
  const places = [{ value: GENERAL, label: t("filter.general") }, ...(tree ?? []).map((node) => ({ value: node.id, label: node.path }))];

  async function add() {
    if (!title.trim() || !day || busy) return;
    setBusy(true);
    const when = time === "all" ? { startsOn: day } : { startsAt: new Date(`${day}T${time}:00`).toISOString() };
    const node = where === GENERAL ? null : where;
    if (calendar === "own") {
      const answer = await tool<{ event: { id: string } }>("create_event", { node, title: title.trim(), ...when });
      setBusy(false);
      if (!answer.ok) return notify({ text: t("calPage.eventNotAdded", { message: answer.message }), tone: "error" });
      onClose();
      touch();
      const id = answer.event.id;
      notify({ text: t("calPage.addedEvent", { title: title.trim() }), tone: "status", undo: () => void saving(tool("delete_event", { id })) });
      return;
    }
    const [account, calendarId] = calendar.split("|");
    const answer = await tool<{ event: { id: string; accountId: string; calendarId: string } }>("create_google_event", { account, calendar: calendarId, title: title.trim(), ...when });
    if (!answer.ok) {
      setBusy(false);
      return notify({ text: t("calPage.eventNotAdded", { message: answer.message }), tone: "error" });
    }
    if (node) await tool("link_node_event", { node, account, calendar: calendarId, googleEvent: answer.event.id });
    setBusy(false);
    onClose();
    touch();
    const created = answer.event;
    notify({
      text: t("calPage.addedEvent", { title: title.trim() }),
      tone: "status",
      undo: () => void saving(tool("delete_google_event", { account: created.accountId, calendar: created.calendarId, event: created.id })),
    });
  }

  return (
    <dialog {...props} className="dialog cal-dialog" aria-labelledby="new-event-title" data-new-event>
      <PopupLayerProvider container={ref}>
        {kept && (
          <form
            className="cal-dialog-in" data-cascade
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <div className="cal-dialog-head">
              <h2 id="new-event-title" className="t-title">
                {t("calPage.newEvent")}
              </h2>
            </div>
            <label className="cal-field">
              <span className="t-label">{t("calPage.titleLabel")}</span>
              <Field autoFocus name="title" lang={lang} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("calPage.titlePlaceholder")} maxLength={500} />
            </label>
            <div className="cal-fields">
              <div className="cal-field">
                <span className="t-label">{t("calPage.dayLabel")}</span>
                <DatePicker label={t("calPage.dayLabel")} value={day} onChange={setDay} />
              </div>
              <div className="cal-field">
                <span className="t-label">{t("calPage.timeLabel")}</span>
                <Select label={t("calPage.timeLabel")} value={time} options={times()} onChange={setTime} />
              </div>
            </div>
            <div className="cal-field">
              <span className="t-label">{t("calPage.calendarLabel")}</span>
              {calendars.length > 1 ? (
                <Select label={t("calPage.calendarLabel")} value={calendar} options={calendars} onChange={setCalendar} />
              ) : (
                <p className="t-value cal-read">{ownCalendar()}</p>
              )}
              {calendars.length === 1 && (
                <p className="t-help">
                  {demoOnly
                    ? t("calPage.sampleReadOnly")
                    : t("calPage.withGoogle")}
                </p>
              )}
            </div>
            <div className="cal-field">
              <span className="t-label">{t("filter.clientOrProject")}</span>
              <Select label={t("filter.clientOrProject")} value={where} options={places} onChange={setWhere} />
            </div>
            <div className="cal-dialog-foot">
              <Button onClick={onClose}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary" disabled={!title.trim() || !day || busy}>
                {busy ? t("quick.adding") : t("calPage.addEvent")}
              </Button>
            </div>
          </form>
        )}
      </PopupLayerProvider>
    </dialog>
  );
}

function EventDetail({ event, sample, tree, tasks, onClose }: { event: CalEvent | null; sample: boolean; tree: TreeNode[] | null; tasks: TaskData[]; onClose: () => void }) {
  const { t } = useStrings();
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

  if (!shown) return <dialog {...props} className="dialog cal-dialog" aria-label={t("calPage.event")} />;
  const items = inside?.key === key ? inside.items : null;
  const linkedNodes = shown.linkedNodeIds.map((id) => tree?.find((node) => node.id === id)).filter((node): node is TreeNode => Boolean(node));
  const target = shown.origin === "local" ? { event: shown.localId } : { account: shown.accountId, calendar: shown.calendarId, googleEvent: shown.id };
  const inEvent = new Set((items ?? []).map((item) => item.id));
  const candidates = tasks.filter((task) => task.status === "open" && !inEvent.has(task.id));
  const nodeCandidates = (tree ?? []).filter((node) => !shown.linkedNodeIds.includes(node.id) && node.id !== shown.nodeId);
  const place = shown.nodePath ?? (shown.origin === "google" ? (tree?.find((node) => node.id === shown.fromNodeId)?.path ?? null) : null);

  async function linkTask(task: TaskData) {
    const answer = await tool("link_task_event", { task: task.id, ...target });
    if (!answer.ok) return notify({ text: t("calPage.couldNotLink", { title: inlinePlain(task.title), message: answer.message }), tone: "error" });
    setReread((n) => n + 1);
    touch();
    notify({ text: t("calPage.linkedTo", { title: inlinePlain(task.title), event: shown!.title }), tone: "status", undo: () => void saving(tool("unlink_task_event", { task: task.id })) });
  }
  async function unlinkTask(item: Item) {
    const answer = await tool("unlink_task_event", { task: item.id });
    if (!answer.ok) return notify({ text: t("calPage.couldNotUnlink", { title: inlinePlain(item.title), message: answer.message }), tone: "error" });
    setReread((n) => n + 1);
    touch();
    notify({ text: t("calPage.unlinkedFrom", { title: inlinePlain(item.title), event: shown!.title }), tone: "status", undo: () => void saving(tool("link_task_event", { task: item.id, ...target })) });
  }
  async function linkNode(node: TreeNode) {
    const answer = await tool("link_node_event", { node: node.id, ...target });
    if (!answer.ok) return notify({ text: t("calPage.placeCouldNotLink", { path: node.path, message: answer.message }), tone: "error" });
    touch();
    notify({ text: t("calPage.placeLinkedTo", { path: node.path, event: shown!.title }), tone: "status", undo: () => void saving(tool("unlink_node_event", { node: node.id, ...target })) });
  }
  async function unlinkNode(node: TreeNode) {
    const answer = await tool("unlink_node_event", { node: node.id, ...target });
    if (!answer.ok) return notify({ text: t("calPage.placeCouldNotUnlink", { path: node.path, message: answer.message }), tone: "error" });
    touch();
    notify({ text: t("calPage.placeUnlinkedFrom", { path: node.path, event: shown!.title }), tone: "status", undo: () => void saving(tool("link_node_event", { node: node.id, ...target })) });
  }
  async function remove() {
    const current = shown!;
    if (current.origin === "local" && current.localId) {
      const id = current.localId;
      const answer = await tool("delete_event", { id });
      if (!answer.ok) return notify({ text: t("row.couldNotDelete", { title: current.title, message: answer.message }), tone: "error" });
      onClose();
      touch();
      notify({ text: t("workspace.deletedItem", { title: current.title }), tone: "status", undo: () => void saving(post(`/api/events/${id}/restore`, {})) });
      return;
    }
    const answer = await tool("delete_google_event", { account: current.accountId, calendar: current.calendarId, event: current.id });
    if (!answer.ok) return notify({ text: t("row.couldNotDelete", { title: current.title, message: answer.message }), tone: "error" });
    onClose();
    touch();
    notify({ text: t("calPage.deletedFromGoogle", { title: current.title }), tone: "status" });
  }

  const linkEntries: MenuEntry[] = [
    {
      kind: "submenu",
      label: t("calPage.aTask"),
      entries: candidates.length
        ? candidates.slice(0, 40).map((task): MenuEntry => ({ kind: "action", label: inlinePlain(task.title), detail: task.path ?? t("filter.general"), onSelect: () => void linkTask(task) }))
        : [{ kind: "action", label: t("calPage.noOpenTask"), disabled: true, onSelect: () => undefined }],
    },
    {
      kind: "submenu",
      label: t("calPage.aClientOrProject"),
      entries: nodeCandidates.length
        ? nodeCandidates.map((node): MenuEntry => ({ kind: "action", label: node.path, onSelect: () => void linkNode(node) }))
        : [{ kind: "action", label: t("calPage.everyLinked"), disabled: true, onSelect: () => undefined }],
    },
  ];

  return (
    <dialog {...props} className="dialog cal-dialog" aria-labelledby="event-title" data-event-detail={shown.id}>
      <PopupLayerProvider container={ref}>
        <div className="cal-dialog-in" data-cascade>
          <div className="cal-dialog-head">
            <p className="t-meta cal-dialog-origin">
              {shown.origin === "local" ? <BrandMark className="cal-origin-mark" /> : <GoogleCalendarMark className="cal-origin-mark" />}
              {shown.origin === "local" ? ownCalendar() : t("calPage.googleCalendar", { email: shown.accountEmail })}
            </p>
            <div className="cal-dialog-tools">
              <Menu
                label={t("common.more")}
                about={t("board.moreFor", { name: `“${shown.title}”` })}
                entries={[{ kind: "action", label: t("calPage.delete"), tone: "danger", disabled: sample, detail: sample ? t("calPage.sampleReadOnlyShort") : undefined, onSelect: () => void remove() }]}
              />
              <Button size="sm" onClick={onClose}>
                {t("common.close")}
              </Button>
            </div>
          </div>
          <h2 id="event-title" className="t-title cal-event-name" tabIndex={-1}>
            {shown.title}
          </h2>
          <dl className="cal-facts">
            <div>
              <dt className="t-label">{t("calPage.when")}</dt>
              <dd className="t-value">{whenText(shown)}</dd>
            </div>
            <div>
              <dt className="t-label">{t("filter.clientOrProject")}</dt>
              <dd className="t-value">{place ?? t("filter.general")}</dd>
            </div>
            {shown.location && (
              <div>
                <dt className="t-label">{t("calPage.location")}</dt>
                <dd className="t-value">{shown.location}</dd>
              </div>
            )}
          </dl>

          <section className="cal-linked" aria-labelledby="event-linked">
            <div className="cal-linked-head">
              <h3 id="event-linked" className="t-label">
                {t("calPage.linked")}
              </h3>
              <Menu label={t("calPage.linkTo")} name={t("calPage.linkNamed", { title: shown.title })} entries={linkEntries} className="cal-link-menu" />
            </div>
            <h4 className="t-meta cal-linked-kind">{t("calPage.tasksSubtasks")}</h4>
            {shown.origin === "google" ? (
              <p className="t-help">{t("calPage.linkedTasksShow")}</p>
            ) : items === null ? (
              inside?.key === key && inside.error ? (
                <p className="inline-note" data-tone="alert">
                  {t("calPage.eventTasksNotLoaded", { message: inside.error })}
                </p>
              ) : (
                <span className="skeleton" aria-label={t("calPage.loadingEventTasks")} />
              )
            ) : items.length === 0 ? (
              <p className="t-help">{t("calPage.noLinkedTasks")}</p>
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
                      <span className="t-meta">{item.parentId ? t("calPage.subtask") : t("type.task")}, {item.nodePath ?? t("filter.general")}</span>
                    </button>
                    <Button size="sm" variant="quiet" onClick={() => void unlinkTask(item)} aria-label={t("calPage.unlinkNamed", { title: inlinePlain(item.title) })}>
                      {t("calPage.unlink")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="t-meta cal-linked-kind">{t("calPage.clientsProjects")}</h4>
            {linkedNodes.length === 0 ? (
              <p className="t-help">{t("calPage.noLinkedPlaces")}</p>
            ) : (
              <ul className="cal-linked-list">
                {linkedNodes.map((node) => (
                  <li key={node.id} className="cal-linked-row">
                    <span className="t-value cal-linked-node" data-color={node.color ?? undefined}>
                      {node.path}
                    </span>
                    <Button size="sm" variant="quiet" onClick={() => void unlinkNode(node)} aria-label={t("calPage.unlinkPlace", { path: node.path })}>
                      {t("calPage.unlink")}
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
