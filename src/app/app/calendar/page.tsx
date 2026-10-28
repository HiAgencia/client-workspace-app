"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore, useCallback, useEffect, useMemo, useState, ViewTransition, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { addDays, addMonths, dayOf, firstWeekday, instantsOf, isDay, LOCALE, longDay, monthGrid, monthTitle, rangeLabel, today, weekdayNames, weekOf, type Day } from "@/lib/dates";
import { get, post, tool, type CalendarEvent, type EventsFailure, type Item } from "../client-api";
import { ItemList, ItemRow } from "../items";
import { useWorkspace } from "../workspace";

type Event = CalendarEvent & { origin: "google" | "local"; localId: string | null; nodeId: string | null; calendarId?: string };
type Events = { events: Event[]; failures: EventsFailure[] };
type Account = { id: string; email: string; status: string; isDemo: boolean; calendars: Array<{ id: string; name: string; selected: boolean }> };

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <Calendar />
    </Suspense>
  );
}

// The days an event covers, in the browser's calendar: a whole day spans its days (the last included), a timed event the
// days it touches.
function daysOf(event: Event): Day[] {
  const first = event.allDay ? event.start.slice(0, 10) : dayOf(new Date(event.start));
  let last = event.allDay ? event.end.slice(0, 10) : dayOf(new Date(Date.parse(event.end) - 1));
  // A Google whole day ends the next day; the workspace's own already says its last day.
  if (event.allDay && event.origin === "google") last = addDays(last, -1);
  const days: Day[] = [];
  for (let day = first; day <= last && days.length < 62; day = addDays(day, 1)) days.push(day);
  return days.length ? days : [first];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

// The calendar: a month or a week of days, each with the tasks due that day and the events of the Google accounts and
// of the workspace itself; a day opens its detail, where events are created, changed, and deleted. A task without a due
// date is not on any day.
const noSubscription = () => () => {};

function Calendar() {
  // The days, the week's first day, and the dates are the browser's: the server's zone and locale never paint them.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { version, tree, saving, notify, touch } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = params.get("view") === "week" ? "week" : "month";
  const anchor = isDay(params.get("date")) ? (params.get("date") as Day) : today();
  const scope = params.get("scope") || null;
  const [selected, setSelected] = useState<Day>(anchor);
  const [weekStart] = useState(() => firstWeekday());
  const range = view === "week" ? weekOf(anchor, weekStart) : (() => {
    const weeks = monthGrid(anchor, weekStart);
    return { from: weeks[0][0], to: weeks.at(-1)!.at(-1)! };
  })();
  const [tasks, setTasks] = useState<Item[] | null>(null);
  const [events, setEvents] = useState<Events | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

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
      tool<{ items: Item[] }>("browse_items", { ...(scope ? { node: scope } : {}), type: ["task"], status: "all", from: range.from, to: range.to, sort: "due", limit: 500 }),
      tool<Events>("browse_events", { ...(scope ? { node: scope } : {}), from: instants.from, to: instants.to, fromDay: range.from, toDay: range.to }),
      get<{ accounts: Account[] }>("/api/accounts"),
    ]).then(([items, calendar, accountsAnswer]) => {
      if (!live) return;
      setTasks(items.ok ? items.items : []);
      setEvents(calendar.ok ? calendar : { events: [], failures: [{ accountId: "", accountEmail: "", reason: calendar.message }] });
      if (accountsAnswer.ok) setAccounts(accountsAnswer.accounts);
    });
    return () => {
      live = false;
    };
    // The range is derived from the URL's view and date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor, scope, version]);

  const byDay = useMemo(() => {
    const map = new Map<Day, { tasks: Item[]; events: Event[] }>();
    const slot = (day: Day) => map.get(day) ?? (map.set(day, { tasks: [], events: [] }), map.get(day)!);
    for (const task of tasks ?? []) if (task.dueOn) slot(task.dueOn).tasks.push(task);
    for (const event of events?.events ?? []) for (const day of daysOf(event)) slot(day).events.push(event);
    return map;
  }, [tasks, events]);

  const weeks = view === "week" ? [Array.from({ length: 7 }, (_, i) => addDays(range.from, i))] : monthGrid(anchor, weekStart);
  const names = weekdayNames(weekStart);
  const month = anchor.slice(0, 7);
  const step = (direction: 1 | -1) => set({ date: view === "month" ? addMonths(anchor, direction) : addDays(anchor, 7 * direction) });
  const writable = accounts.filter((account) => !account.isDemo && account.status === "active");
  const scopeOptions = [{ value: "all", label: "Everything" }, ...(tree ?? []).map((node) => ({ value: node.id, label: node.path }))];
  const detail = byDay.get(selected) ?? { tasks: [], events: [] };

  async function removeEvent(event: Event) {
    if (event.origin === "local" && event.localId) {
      const answer = await tool("delete_event", { id: event.localId });
      if (!answer.ok) return notify({ text: answer.message, tone: "error" });
      touch();
      notify({ text: `Deleted “${event.title}”`, tone: "status", undo: () => void saving(post(`/api/events/${event.localId}/restore`, {})) });
    } else {
      await saving(tool("delete_google_event", { account: event.accountId, calendar: event.calendarId, event: event.id }));
    }
  }

  if (!mounted) return null;
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page" data-calendar={view}>
        <header className="card page-head">
          <p className="t-meta">{view === "week" ? rangeLabel(range.from, range.to) : "Tasks by their due date, and the events of every calendar"}</p>
          <h1 className="t-h1" tabIndex={-1}>
            {view === "week" ? `Week of ${rangeLabel(range.from, range.to)}` : monthTitle(anchor)}
          </h1>
          <div className="panel-bar">
            <Tabs label="Calendar view" value={view} onChange={(next) => set({ view: next })} options={[{ value: "month", label: "Month", controls: "calendar-grid" }, { value: "week", label: "Week", controls: "calendar-grid" }]} />
            <div className="inline" role="group" aria-label="Move the range">
              <Button size="sm" onClick={() => step(-1)}>
                Previous
              </Button>
              <Button size="sm" onClick={() => {
                  set({ date: null });
                  setSelected(today());
                }} disabled={anchor === today()}>
                Today
              </Button>
              <Button size="sm" onClick={() => step(1)}>
                Next
              </Button>
            </div>
            <div className="panel-scope">
              <Select label="Scope" value={scope ?? "all"} options={scopeOptions} onChange={(value) => set({ scope: value === "all" ? null : value })} />
            </div>
          </div>
        </header>

        {events?.failures.map((failure) => (
          <p key={failure.accountId} role="alert" className="inline-note" data-tone="alert">
            {failure.accountEmail || "The calendars"} could not be read: {failure.reason}
          </p>
        ))}

        <section className="card" aria-label={view === "week" ? "The week" : "The month"} id="calendar-grid">
          <table className="cal-month" role="grid" data-calendar-grid>
            <thead>
              <tr>
                {names.map((name) => (
                  <th key={name.long} scope="col" abbr={name.long} className="t-meta">
                    {name.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((day) => {
                    const entry = byDay.get(day);
                    const count = (entry?.tasks.length ?? 0) + (entry?.events.length ?? 0);
                    return (
                      <td key={day} data-outside={view === "month" && day.slice(0, 7) !== month ? "" : undefined}>
                        <button
                          type="button"
                          className="cal-cell"
                          data-day={day}
                          aria-pressed={day === selected}
                          aria-current={day === today() ? "date" : undefined}
                          aria-label={`${longDay(day)}: ${count === 0 ? "nothing" : `${entry?.tasks.length ?? 0} tasks, ${entry?.events.length ?? 0} events`}`}
                          onClick={() => setSelected(day)}
                        >
                          <span className="cal-cell-day">{Number(day.slice(8))}</span>
                          <span className="cal-cell-items" aria-hidden="true">
                            {entry?.events.slice(0, 3).map((event) => (
                              <span key={`${event.origin}:${event.id}`} className="cal-chip" data-origin={event.origin}>
                                {event.allDay ? "" : `${time(event.start)} `}
                                {event.title}
                              </span>
                            ))}
                            {entry?.tasks.slice(0, 3).map((task) => (
                              <span key={task.id} className="cal-chip" data-origin="task" data-done={task.status === "done" || undefined}>
                                {task.title}
                              </span>
                            ))}
                            {count > 6 && <span className="t-meta">+{count - 6} more</span>}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card stack" aria-labelledby="day-title" data-day-detail={selected}>
          <div className="card-head">
            <h2 id="day-title" className="t-title">
              {longDay(selected)}
            </h2>
          </div>
          <h3 className="t-label">Events</h3>
          {detail.events.length === 0 ? (
            <p className="t-help">No events this day.</p>
          ) : (
            <ul className="plain-list stack">
              {detail.events.map((event) => (
                <EventRow key={`${event.origin}:${event.id}`} event={event} onRemove={() => void removeEvent(event)} tasks={tasks ?? []} />
              ))}
            </ul>
          )}
          <NewEvent day={selected} scope={scope} accounts={writable} />
          <h3 className="t-label">Tasks due</h3>
          {detail.tasks.length === 0 ? (
            <p className="t-help">No task falls due this day. Tasks without a due date are not on the calendar.</p>
          ) : (
            <ItemList items={detail.tasks}>{(item) => <ItemRow item={item} showPath />}</ItemList>
          )}
        </section>
      </div>
    </ViewTransition>
  );
}

// One event of the day: where it comes from, what lives in it, and its change and delete.
function EventRow({ event, onRemove, tasks }: { event: Event; onRemove: () => void; tasks: Item[] }) {
  const { saving } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [inside, setInside] = useState<Item[] | null>(null);

  useEffect(() => {
    if (event.origin !== "local" || !event.localId) return;
    void get<{ items: Item[] }>(`/api/events/${event.localId}/tasks`).then((answer) => answer.ok && setInside(answer.items));
  }, [event]);

  async function rename() {
    setEditing(false);
    if (!title.trim() || title === event.title) return setTitle(event.title);
    if (event.origin === "local") await saving(tool("update_event", { id: event.localId, title }));
    else await saving(tool("update_google_event", { account: event.accountId, calendar: event.calendarId, event: event.id, title }));
  }

  const candidates = tasks.filter((task) => task.status === "open" && (!event.nodeId || task.nodeId === event.nodeId) && !inside?.some((i) => i.id === task.id));
  return (
    <li className="event-row" data-event={event.id} data-origin={event.origin}>
      <div className="stack" style={{ gap: "0.15rem" }}>
        {editing ? (
          <Field
            autoFocus
            aria-label="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") void rename();
              if (e.key === "Escape") {
                setTitle(event.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button type="button" className="row-title t-value" onClick={() => setEditing(true)} aria-label={`Rename “${event.title}”`}>
            {event.title}
          </button>
        )}
        <span className="t-meta">
          {event.allDay ? "All day" : `${time(event.start)}–${time(event.end)}`} ·{" "}
          {event.origin === "local" ? <span className="pill">Workspace event · {event.calendarName}</span> : <span className="pill" data-tone="info">Google · {event.accountEmail}</span>}
        </span>
        {inside && inside.length > 0 && (
          <span className="t-meta" data-event-tasks>
            Tasks inside: {inside.map((task) => task.title).join(", ")}
          </span>
        )}
      </div>
      <div className="row-act">
        {event.origin === "local" && candidates.length > 0 && (
          <Select
            look="chip"
            label={`Put a task in “${event.title}”`}
            placeholder="Put a task in it…"
            value={null}
            options={candidates.map((task) => ({ value: task.id, label: task.title }))}
            onChange={(taskId) => void saving(tool("link_task_event", { task: taskId, event: event.localId }))}
          />
        )}
        <Button size="sm" variant="quiet" onClick={onRemove} aria-label={`Delete “${event.title}”`}>
          Delete
        </Button>
      </div>
    </li>
  );
}

// A new event on the selected day: the workspace's own by default, or in a connected Google account's calendar.
function NewEvent({ day, scope, accounts }: { day: Day; scope: string | null; accounts: Account[] }) {
  const { saving, tree } = useWorkspace();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [onDay, setOnDay] = useState<Day | null>(day);
  const [where, setWhere] = useState<string>("workspace");
  const [node, setNode] = useState<string | null>(scope);
  const [prevDay, setPrevDay] = useState(day);
  if (prevDay !== day) {
    setPrevDay(day);
    setOnDay(day);
  }
  const places = [
    { value: "workspace", label: "The workspace's calendar" },
    ...accounts.flatMap((account) => account.calendars.map((calendar) => ({ value: `${account.id}|${calendar.id}`, label: `${calendar.name} · ${account.email}` }))),
  ];

  async function add() {
    if (!title.trim() || !onDay) return;
    const when = start ? { startsAt: new Date(`${onDay}T${start}`).toISOString() } : { startsOn: onDay };
    let request;
    if (where === "workspace") {
      if (!node) return;
      request = tool("create_event", { node, title, ...when });
    } else {
      const [account, calendar] = where.split("|");
      request = tool("create_google_event", { account, calendar, title, ...when });
    }
    if (await saving(request)) {
      setTitle("");
      setStart("");
    }
  }

  return (
    <div className="stack new-event" data-new-event>
      <div className="quick-add">
        <Field id="new-event-title" name="new-event-title" aria-label="New event" placeholder="New event" className="grow" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && void add()} />
        <DatePicker label="Day of the new event" value={onDay} onChange={setOnDay} />
        <Field id="new-event-time" name="new-event-time" aria-label="Start time (HH:MM, empty for all day)" placeholder="All day, or 14:30" className="second" value={start} onChange={(e) => setStart(e.target.value.replace(/[^\d:]/g, "").slice(0, 5))} />
      </div>
      <div className="quick-add">
        <Select label="Calendar of the new event" value={where} options={places} onChange={setWhere} />
        {where === "workspace" && (
          <Select label="Project of the new event" placeholder="Pick its project…" value={node} options={(tree ?? []).map((n) => ({ value: n.id, label: n.path }))} onChange={setNode} />
        )}
        <Button variant="primary" onClick={() => void add()} disabled={!title.trim() || (where === "workspace" && !node) || (start !== "" && !/^\d{1,2}:\d{2}$/.test(start))}>
          Add event
        </Button>
      </div>
    </div>
  );
}
