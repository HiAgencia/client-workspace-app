"use client";

import { Link } from "@/components/ui/link";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { Fold } from "@/components/ui/fold";
import { usePiece } from "@/components/ui/use-piece";
import { count } from "@/lib/count";
import { addDays, instantsOf, LOCALE, longDay, weekOf, type Day } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import { mailFailureText } from "@/lib/mail/failure-text";
import { repliesText } from "@/lib/mail/replies-text";
import type { MailRow } from "@/lib/tools/mail-schema";
import type { NoteRow } from "@/lib/tools/notes";
import type { TasksView } from "@/lib/tools/tasks";
import { buttonClass } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { BoxEmpty, BoxFailed, BoxWait, useBoxSettled, useToolRead, type BoxRead } from "./boxes";
import { useEventsRead } from "./use-events-read";
import { get, post, tool, type CalendarEvent, type Item, type TreeNode } from "./client-api";
import { PathText } from "./item-parts";
import { accountsSeenFrom, figureWords, type MailList } from "./mail-store";
import { subjectOf } from "./mail/subject";
import type { TaskReplies } from "./task-replies";
import { useQuickAddInline } from "./quick-add";
import { dayHeading, dayName, InlineText, pasteLinkOver, PlaceName, placeOnPage, TaskList, timeLabel, useTaskActions, useTaskLanding, type TaskData } from "./task-row";
import { useWorkspace } from "./workspace";






export type Place = { kind: "all" } | { kind: "general" } | { kind: "node"; id: string };


export function placeInput(place: Place): Record<string, unknown> {
  if (place.kind === "all") return {};
  if (place.kind === "general") return { node: null };
  return { node: place.id };
}


export function readPlace(value: string | null, tree: TreeNode[] | null): Place {
  if (value === "general") return { kind: "general" };
  if (value && /^[0-9a-f-]{36}$/.test(value) && (!tree || tree.some((node) => node.id === value))) return { kind: "node", id: value };
  return { kind: "all" };
}

export function placeValue(place: Place): string | null {
  return place.kind === "all" ? null : place.kind === "general" ? "general" : place.id;
}


export function HeadLink({ href, name, children }: { href: string; name: string; children: string }) {
  return (
    <Link className={buttonClass({ variant: "quiet", size: "sm", className: "head-action" })} href={href} aria-label={name}>
      <span className="btn-label">{children}</span>
    </Link>
  );
}



export type Sort = "date" | "priority" | "manual";

type GroupsProps = {
  view: TasksView;
  now: Day;
  
  mode: "box" | "page";
  layout: "list" | "board";
  
  placeId: string | null;
  
  place: Place;
  showPlace: boolean;
  
  pageNode?: string | null;
  sort?: Sort;
  
  allHref?: string;
};

type Group = {
  key: string;
  label: string;
  tone?: string;
  tasks: TaskData[];
  count: number;
  dropDay: Day | null | undefined;
  dayShown?: Day | null;
  
  add?: Day | null;
  empty: string;
  
  days?: Group[];
  action?: ReactNode;
};

export function TaskGroups({ view, now, mode, layout, placeId, place, showPlace, pageNode, sort = "date", allHref }: GroupsProps) {
  const manual = sort === "manual";
  
  
  const folded = mode === "box" && layout === "list";
  const upcomingDays: Group[] = view.groups.upcoming.days.map((entry) => ({
    key: entry.day,
    label: dayHeading(entry.day, now),
    tone: entry.day === addDays(now, 1) ? "tomorrow" : entry.day < addDays(now, 7) ? "week" : undefined,
    tasks: entry.tasks,
    count: entry.count,
    dropDay: entry.day,
    dayShown: entry.day,
    add: mode === "page" ? entry.day : undefined,
    empty: "",
  }));
  const groups: Group[] = [
    {
      key: "overdue",
      label: "Overdue",
      tone: "overdue",
      tasks: view.groups.overdue.tasks,
      count: view.groups.overdue.count,
      dropDay: undefined,
      
      empty: "Nothing is overdue.",
      action: view.groups.overdue.count > 0 ? <Reschedule count={view.groups.overdue.count} place={place} now={now} /> : undefined,
    },
    {
      key: "today",
      label: "Today",
      tone: "today",
      tasks: view.groups.today.tasks,
      count: view.groups.today.count,
      dropDay: now,
      dayShown: now,
      add: now,
      empty: "Nothing is due today.",
    },
    {
      key: "upcoming",
      label: "Upcoming",
      tasks: [],
      count: view.groups.upcoming.count,
      dropDay: undefined,
      add: mode === "box" && !folded ? addDays(now, 1) : undefined,
      empty: "Nothing is coming up.",
      days: upcomingDays,
      action:
        mode === "box" && allHref && view.groups.upcoming.count > 0 ? (
          <HeadLink href={allHref} name="Show all upcoming">
            Show all
          </HeadLink>
        ) : undefined,
    },
    ...(mode === "page"
      ? [
          {
            key: "noDate",
            label: "No date",
            tasks: view.groups.noDate.tasks,
            count: view.groups.noDate.count,
            dropDay: null,
            add: null,
            empty: "Every task has a date.",
          } satisfies Group,
        ]
      : []),
    ...(view.completed
      ? [
          {
            key: "completed",
            label: "Completed",
            tasks: view.completed.tasks,
            count: view.completed.count,
            dropDay: undefined,
            empty: "Nothing is completed yet.",
          } satisfies Group,
        ]
      : []),
  ];
  
  const shown = groups.filter((group) => group.key !== "overdue" || group.count > 0);
  const reorderable = (group: Group) => group.key !== "completed" && (manual || (sort === "date" && group.key === "noDate"));

  const list = (group: Group) => (
    <TaskList
      group={group.key}
      label={group.label}
      tasks={group.tasks}
      layout={layout}
      showPlace={showPlace}
      pageNode={pageNode}
      dayShown={group.dayShown ?? null}
      dropDay={group.dropDay}
      reorderable={reorderable(group)}
    />
  );

  return (
    <div className="groups" data-layout={layout} data-mode={mode}>
      {ZONES.map((zone) => (
        <div key={zone} className="groups-zone" data-zone={zone}>
          {shown
            .filter((group) => zoneOf(group.key) === zone)
            .map((group) => (
              <GroupSection key={group.key} group={group} placeId={placeId}>
                {group.days ? (
                  <>
                    {group.days.length === 0 && <p className="t-help group-empty">{group.empty}</p>}
                    {group.days.map((day) =>
                      folded ? (
                        <UpcomingDay key={day.key} day={day} tasks={allTasks(view)} now={now}>
                          {list(day)}
                        </UpcomingDay>
                      ) : (
                        <DaySection key={day.key} day={day} placeId={placeId}>
                          {list(day)}
                        </DaySection>
                      ),
                    )}
                  </>
                ) : (
                  <>
                    {list(group)}
                    {group.tasks.length === 0 && <p className="t-help group-empty">{group.empty}</p>}
                  </>
                )}
              </GroupSection>
            ))}
        </div>
      ))}
    </div>
  );
}



const ZONES = ["now", "ahead", "rest"] as const;
const zoneOf = (group: string) => (group === "overdue" || group === "today" ? "now" : group === "upcoming" ? "ahead" : "rest");


function GroupSection({ group, placeId, children }: { group: Group; placeId: string | null; children: ReactNode }) {
  const add = useQuickAddInline({ day: group.add ?? null, placeId });
  const adds = group.add !== undefined;
  return (
    <section className="group" data-group={group.key} aria-labelledby={`group-${group.key}`}>
      <div className="group-top">
        <div className="group-head">
          <h3 id={`group-${group.key}`} className="group-title" data-when={group.tone}>
            {group.label}
          </h3>
          {group.count > 0 && <span className="group-count">{count(group.count, "task", "tasks")}</span>}
          {(group.action || adds) && (
            <div className="group-action">
              {group.action}
              {adds && add.trigger}
            </div>
          )}
        </div>
        {adds && add.editor}
      </div>
      {children}
    </section>
  );
}


function DaySection({ day, placeId, children }: { day: Group; placeId: string | null; children: ReactNode }) {
  const add = useQuickAddInline({ day: day.add ?? null, placeId });
  const adds = day.add !== undefined;
  return (
    <div className="group-day" data-day={day.key}>
      <div className="group-top">
        <div className="group-day-head">
          <h4 className="group-day-title" data-when={day.tone}>
            {day.label}
          </h4>
          {adds && <div className="group-action">{add.trigger}</div>}
        </div>
        {adds && add.editor}
      </div>
      {children}
    </div>
  );
}



function UpcomingDay({ day, tasks, now, children }: { day: Group; tasks: TaskData[]; now: Day; children: ReactNode }) {
  const actions = useTaskActions();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const foldId = useId();
  const landing = useTaskLanding(day.key);
  if (landing && !open) setOpen(true);
  const others = day.count - 1;

  function onDrop(event: DragEvent<HTMLElement>) {
    setOver(false);
    const task = tasks.find((entry) => entry.id === draggedTask);
    if (!task) return;
    event.preventDefault();
    void actions.moveToDay(task, day.key, day.key, dayName(day.key, now));
  }

  return (
    <div className="group-day" data-day={day.key}>
      <h4 className="upcoming-day-head">
        <button
          type="button"
          className="upcoming-day"
          data-upcoming-day
          data-over={over || undefined}
          aria-expanded={open}
          aria-controls={foldId}
          onClick={() => setOpen((value) => !value)}
          onDragOver={(event) => {
            if (!draggedTask) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <span className="upcoming-day-name" data-when={day.tone}>
            {day.label}
          </span>
          {day.tasks[0] && <span className="upcoming-day-first">{inlinePlain(day.tasks[0].title)}</span>}
          {others > 0 && <span className="upcoming-day-more">{`+${others} more`}</span>}
        </button>
      </h4>
      <Fold open={open} id={foldId}>
        {children}
      </Fold>
    </div>
  );
}


export function allTasks(view: TasksView | null): TaskData[] {
  if (!view) return [];
  return [...view.groups.overdue.tasks, ...view.groups.today.tasks, ...view.groups.upcoming.days.flatMap((day) => day.tasks), ...view.groups.noDate.tasks];
}


function Reschedule({ count: overdue, place, now }: { count: number; place: Place; now: Day }) {
  const { notify, touch, saving } = useWorkspace();
  async function move(day: Day | null) {
    if (!day) return;
    const answer = await tool<{ count: number; changed: Array<{ id: string; previousDueOn: string }> }>("reschedule_overdue", { ...placeInput(place), today: now, to: day });
    if (!answer.ok) return notify({ text: `The overdue tasks could not be moved: ${answer.message}`, tone: "error" });
    touch();
    const back = answer.changed;
    notify({
      text: `Moved ${count(answer.count, "overdue task", "overdue tasks")} to ${dayName(day, now)}`,
      tone: "status",
      undo: () => void saving(Promise.all(back.map((task) => tool("update_item", { id: task.id, dueOn: task.previousDueOn }))).then((all) => all.find((one) => !one.ok) ?? { ok: true })),
    });
  }
  return <DatePicker look="chip" className="reschedule head-action" label={`Reschedule the ${count(overdue, "overdue task", "overdue tasks")}`} value={null} display="Reschedule" onChange={(day) => void move(day)} />;
}


export function useTasksRead(place: Place, now: Day | null, extra: Record<string, unknown> = {}): BoxRead<TasksView> {
  return useToolRead<TasksView>("get_tasks", now ? { ...placeInput(place), today: now, ...extra } : null);
}


export function TasksBoxContent({ read, now, place, placeId, showPlace, pageNode, layout, allHref }: { read: BoxRead<TasksView>; now: Day; place: Place; placeId: string | null; showPlace: boolean; pageNode?: string | null; layout: "list" | "board"; allHref: string }) {
  const { data, error, stale, retry } = read;
  useBoxSettled(read.settled);
  if (!data) return error ? <BoxFailed what="The tasks" message={error} kept={false} onRetry={retry} /> : <BoxWait what="Reading the tasks…" />;
  return (
    <div className="box-read" data-stale={stale || undefined} aria-busy={stale || undefined}>
      {error && <BoxFailed what="The tasks" message={error} kept onRetry={retry} />}
      <TaskGroups view={data} now={now} mode="box" layout={layout} placeId={placeId} place={place} showPlace={showPlace} pageNode={pageNode} allHref={allHref} />
    </div>
  );
}



export function tasksCountLabel(view: TasksView | null): string | undefined {
  const due = view ? view.groups.overdue.count + view.groups.today.count : 0;
  return due > 0 ? `${due} due` : undefined;
}


export function noDateCount(view: TasksView | null): string | undefined {
  const tasks = view?.groups.noDate.count ?? 0;
  return tasks > 0 ? count(tasks, "task", "tasks") : undefined;
}

export function notesCount(total: number | undefined): string | undefined {
  return total ? count(total, "note", "notes") : undefined;
}


const FIRST_SHOWN = 5;



export function NoDateBoxContent({ read, showPlace, pageNode }: { read: BoxRead<TasksView>; showPlace: boolean; pageNode?: string | null }) {
  const { data, error, stale, retry } = read;
  const [all, setAll] = useState(false);
  const rowsId = useId();
  const landing = useTaskLanding("noDate");
  if (landing && !all) setAll(true);
  useBoxSettled(read.settled);
  if (!data) return error ? <BoxFailed what="The tasks without a date" message={error} kept={false} onRetry={retry} /> : <BoxWait what="Reading the tasks without a date…" rows={2} />;
  const group = data.groups.noDate;
  const folds = group.tasks.length > FIRST_SHOWN;
  return (
    <div className="box-read" data-stale={stale || undefined} aria-busy={stale || undefined}>
      {error && <BoxFailed what="The tasks without a date" message={error} kept onRetry={retry} />}
      <div id={rowsId} className="first-rows" data-open={all || !folds}>
        <TaskList group="noDate" label="No date" tasks={group.tasks} showPlace={showPlace} pageNode={pageNode} dropDay={null} reorderable />
      </div>
      {group.tasks.length === 0 && <p className="t-help group-empty">Nothing waits without a date. One added here stays without one, in the order you give it.</p>}
      {folds && (
        <button type="button" className="task-add" aria-controls={rowsId} aria-expanded={all} onClick={() => setAll((value) => !value)}>
          {all ? `Show the first ${FIRST_SHOWN}` : `Show all ${group.tasks.length}`}
        </button>
      )}
    </div>
  );
}



type Event = CalendarEvent & { origin: "google" | "local"; localId: string | null; nodeId: string | null; nodePath: string | null; linkedNodeIds: string[] };

function onDay(event: Event, day: Day): boolean {
  if (event.allDay) {
    
    const last = event.origin === "google" ? addDays(event.end.slice(0, 10), -1) : event.end.slice(0, 10);
    return event.start.slice(0, 10) <= day && day <= last;
  }
  const start = Date.parse(event.start);
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const dayEnd = new Date(`${addDays(day, 1)}T00:00:00`).getTime();
  return start < dayEnd && (Date.parse(event.end) > dayStart || start >= dayStart);
}


let draggedTask: string | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("dragstart", (event) => {
    const row = (event.target as Element | null)?.closest?.("[data-item]");
    draggedTask = row instanceof HTMLElement ? (row.dataset.item ?? null) : null;
  });
  window.addEventListener("dragend", () => {
    draggedTask = null;
  });
}

export function CalendarBoxContent({ place, now, weekStart, tasks, calendarHref }: { place: Place; now: Day; weekStart: number; tasks: TaskData[]; calendarHref: string }) {
  const { tree } = useWorkspace();
  const actions = useTaskActions();
  const week = weekOf(now, weekStart);
  const instants = instantsOf(week.from, week.to);
  
  const read = useEventsRead<Event>(
    {
      ...(place.kind === "node" ? { node: place.id } : {}),
      from: instants.from,
      to: instants.to,
      fromDay: week.from,
      toDay: week.to,
    },
    place.kind !== "general",
  );
  const [chosen, setChosen] = useState<Day>(now);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.from, index));
  
  const events = (read.data?.events ?? []).filter((event) => place.kind !== "general" || (event.origin === "local" && event.nodeId === null));
  const ofDay = (day: Day) => events.filter((event) => onDay(event, day));
  const names = new Map((tree ?? []).map((node) => [node.id, node.path]));
  useBoxSettled(read.settled);

  function onDrop(event: DragEvent<HTMLElement>, day: Day) {
    const task = tasks.find((entry) => entry.id === draggedTask);
    if (!task) return;
    event.preventDefault();
    const group = day < now ? "overdue" : day === now ? "today" : day;
    void actions.moveToDay(task, day, group, dayName(day, now));
  }

  if (!read.data && read.error) return <BoxFailed what="The calendar" message={read.error} kept={false} onRetry={read.retry} />;
  if (!read.data) return <BoxWait what="Reading this week's events…" rows={2} />;
  const chosenEvents = ofDay(chosen);
  
  
  const unanswered = read.data.waiting;
  const reading = !read.error && unanswered > 0;
  return (
    <div className="box-read" data-stale={read.stale || undefined} aria-busy={read.stale || reading || undefined}>
      {read.error && <BoxFailed what="The calendar" message={read.error} kept onRetry={read.retry} />}
      {}
      {[...new Set(read.data.failures.map((failure) => failure.reason))].map((reason) => {
        const who = read.data!.failures.filter((failure) => failure.reason === reason).map((failure) => failure.accountEmail || "The workspace's calendar");
        return (
          <p key={reason} className="inline-note" data-tone="alert">
            {`${who.length === 1 ? who[0] : count(who.length, "calendar", "calendars")} could not be read: ${reason}.`}
            {who.length > 1 && <span className="calendar-failed-who">{who.join(", ")}</span>}
          </p>
        );
      })}
      <WeekStrip label={`The week of ${longDay(week.from)}`} days={days} chosen={chosen} now={now} eventsOn={(day) => ofDay(day).length} onChoose={setChosen} onDrop={onDrop} />
      <div className="day-events">
        <h3 className="group-title" data-when={chosen === now ? "today" : undefined}>
          {chosen === now ? "Today" : dayHeading(chosen, now)}
        </h3>
        {}
        {chosenEvents.length === 0 && reading ? (
          <BoxWait what="Reading this week's events…" rows={2} />
        ) : chosenEvents.length === 0 && unanswered > 0 ? (
          <p className="t-help group-empty">This day could not be read.</p>
        ) : chosenEvents.length === 0 ? (
          <BoxEmpty text={`No events ${chosen === now ? "today" : `on ${longDay(chosen)}`} in the calendars in view.`} reason="no-events">
            <Link className={buttonClass({ size: "sm" })} href={calendarHref}>
              <span className="btn-label">Open the calendar</span>
            </Link>
          </BoxEmpty>
        ) : (
          <ul className="event-list">
            {chosenEvents.map((event) => {
              const where = event.nodePath ?? event.linkedNodeIds.map((id) => names.get(id)).filter(Boolean).join(", ") ?? "";
              return (
                <li key={`${event.origin}:${event.accountId}:${event.id}`} className="event-row">
                  <span className="event-when">{event.allDay ? "All day" : timeLabel(new Date(event.start).toTimeString().slice(0, 5))}</span>
                  <span className="event-what">
                    <span className="event-title">{event.title}</span>
                    <span className="event-where">{where ? <PathText path={where} /> : event.origin === "google" ? event.accountEmail : "No client or project"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}



function WeekStrip({
  label,
  days,
  chosen,
  now,
  eventsOn,
  onChoose,
  onDrop,
}: {
  label: string;
  days: Day[];
  chosen: Day;
  now: Day;
  eventsOn: (day: Day) => number;
  onChoose: (day: Day) => void;
  onDrop: (event: DragEvent<HTMLElement>, day: Day) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<Day | null>(null);
  usePiece(rail, '[aria-pressed="true"]');
  return (
    <div ref={rail} className="seg week" role="group" aria-label={label}>
      {days.map((day) => {
        const many = eventsOn(day);
        const date = new Date(`${day}T00:00:00`);
        
        const shown = `${new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(date)} ${date.getDate()}`;
        return (
          <button
            key={day}
            type="button"
            className="seg-option week-day"
            data-day={day}
            aria-pressed={day === chosen}
            aria-current={day === now ? "date" : undefined}
            aria-label={`${shown}, ${longDay(day)}, ${count(many, "event", "events")}`}
            data-over={over === day || undefined}
            onClick={() => onChoose(day)}
            onDragOver={(event) => {
              if (!draggedTask) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== day) setOver(day);
            }}
            onDragLeave={() => setOver((value) => (value === day ? null : value))}
            onDrop={(event) => {
              setOver(null);
              onDrop(event, day);
            }}
          >
            <span className="week-name">{shown.split(" ")[0]}</span> <span className="week-number">{date.getDate()}</span>
            <span className="week-mark" data-some={many > 0 || undefined} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}



export type { MailList };




export function useMailRead(place: Place, account: string | null): BoxRead<MailList> {
  const { tree, treeError, refreshTree, mailAccounts, mailStore, version } = useWorkspace();
  useSyncExternalStore(mailStore.subscribe, mailStore.revision, noRevision);
  const [round, setRound] = useState(0);
  const inPlace = useMemo(() => {
    if (!mailAccounts) return null;
    if (place.kind === "general") return [];
    if (place.kind === "all") return mailAccounts;
    const seen = new Set(accountsSeenFrom(tree, mailAccounts, place.id));
    return mailAccounts.filter((entry) => seen.has(entry.id));
  }, [mailAccounts, tree, place.kind, place.kind === "node" ? place.id : null]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = inPlace?.map((entry) => entry.id).join() ?? "";
  useEffect(() => {
    for (const entry of inPlace ?? []) mailStore.list(entry);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, round, mailStore]);
  const chosen = inPlace?.some((entry) => entry.id === account) ? inPlace.filter((entry) => entry.id === account) : inPlace;
  const data = chosen ? mailStore.mailOf(chosen) : null;
  return {
    data,
    error: chosen ? null : treeError,
    stale: false,
    
    settled: data ? data.accounts.length === 0 || data.waiting < data.accounts.length : treeError !== null,
    
    retry: () => {
      mailStore.forget();
      setRound((value) => value + 1);
      if (!mailAccounts) void refreshTree();
    },
  };
}

const noRevision = () => 0;

const MAIL_ROWS = 3;


export function useMailCount(read: BoxRead<MailList>): string | undefined {
  const { mailStore } = useWorkspace();
  if (!read.data || read.data.accounts.length === 0) return undefined;
  return figureWords(mailStore.figure(read.data.accounts)) ?? undefined;
}

export function mailWhen(iso: string, now: Day): string {
  const date = new Date(iso);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const time = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" }).format(date);
  return day === now ? time : dayName(day, now);
}

const mailKey = (message: MailRow) => `${message.accountId}:${message.id}`;




export function mailBoxRows(mail: MailList, replies: TaskReplies[], account: string | null): Array<{ message: MailRow; label: string | null }> {
  const inAccount = (message: MailRow) => account === null || message.accountId === account;
  const seen = new Set<string>();
  const rows: Array<{ message: MailRow; label: string | null }> = [];
  for (const entry of replies) {
    const own = entry.replies.filter(inAccount);
    
    const shown = own.find((message) => !seen.has(mailKey(message)));
    if (!shown) continue;
    seen.add(mailKey(shown));
    const more = entry.more.some((id) => account === null || id === account);
    rows.push({ message: shown, label: `${repliesText(own.length, more)} for “${inlinePlain(entry.task.title)}”` });
  }
  for (const message of [...mail.groups.forTasks.messages, ...mail.groups.unread.messages]) {
    if (!inAccount(message) || seen.has(mailKey(message))) continue;
    seen.add(mailKey(message));
    rows.push({ message, label: null });
  }
  return rows;
}

export function MailBoxContent({
  read,
  replies,
  account,
  now,
  place,
  connectHref,
}: {
  read: BoxRead<MailList>;
  replies: BoxRead<{ tasks: TaskReplies[] }>;
  
  account: string | null;
  now: Day;
  place: Place;
  connectHref: string;
}) {
  const { tree } = useWorkspace();
  const { data, error, stale, retry } = read;
  useBoxSettled(read.settled && replies.settled);
  if (!data) return error ? <BoxFailed what="The mail" message={error} kept={false} onRetry={retry} /> : <BoxWait what="Reading the mail…" rows={3} />;
  const rows = mailBoxRows(data, replies.data?.tasks ?? [], account).slice(0, MAIL_ROWS);
  const failures = [...data.failures, ...(replies.data?.tasks ?? []).flatMap((entry) => entry.failures).filter((failure) => account === null || failure.accountId === account)].filter(
    (failure, index, all) => all.findIndex((other) => other.accountId === failure.accountId) === index,
  );
  
  const reading = data.waiting > 0;
  const body = () => {
    if (data.accounts.length === 0) {
      return place.kind === "general" ? (
        <BoxEmpty text="General has no mail account: the mail lives in the accounts of each client and project." reason="general">
          <Link className={buttonClass({ size: "sm" })} href="/app/mail">
            <span className="btn-label">Open all mail</span>
          </Link>
        </BoxEmpty>
      ) : (
        <BoxEmpty text="Connect a Google account to see its mail here." reason="no-account">
          <Link className={buttonClass({ size: "sm" })} href={connectHref}>
            <span className="btn-label">Connect Google account</span>
          </Link>
        </BoxEmpty>
      );
    }
    if (rows.length === 0) {
      if (reading) return <BoxWait what="Reading the mail…" rows={3} />;
      return (
        <BoxEmpty text="Nothing unread, and nothing arrived for a task that waits for mail." reason="nothing-unread">
          <Link className={buttonClass({ size: "sm" })} href="/app/mail">
            <span className="btn-label">Open all mail</span>
          </Link>
        </BoxEmpty>
      );
    }
    return (
      <ul className="mail-list">
        {rows.map(({ message, label }) => {
          const linked = message.tasks.find((task) => task.status === "open") ?? message.tasks[0];
          
          const where = message.place ? placeOnPage(message.place, true, place.kind === "node" ? place.id : null, tree) : null;
          return (
            <li key={mailKey(message)}>
              <Link className="mail-row" href={`/app/mail?account=${message.accountId}&message=${encodeURIComponent(message.id)}`} data-unread={message.unread || undefined}>
                <span className="mail-from">{message.from.name || message.from.email}</span>
                <span className="mail-side">
                  {message.important && <span className="pill mail-important">Important</span>}
                  <span className="mail-when">{mailWhen(message.receivedAt, now)}</span>
                </span>
                <span className="mail-subject">{subjectOf(message)}</span>
                <span className="mail-for">
                  {label ? (
                    label
                  ) : linked ? (
                    `For: ${inlinePlain(linked.title)}`
                  ) : where?.shown ? (
                    <PlaceName path={where.path} color={message.place?.color ?? null} />
                  ) : (
                    message.accountEmail
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  };
  return (
    <div className="box-read" data-stale={stale || undefined} aria-busy={stale || undefined}>
      {error && <BoxFailed what="The mail" message={error} kept onRetry={retry} />}
      {replies.error && <BoxFailed what="The possible replies of the tasks" message={replies.error} kept={replies.data !== null} onRetry={replies.retry} />}
      {failures.map((failure) => (
        <p key={failure.accountId} className="inline-note" data-tone={failure.partial ? undefined : "alert"} data-mail-failure>
          {mailFailureText(failure)}
        </p>
      ))}
      {body()}
    </div>
  );
}



type Notes = { notes: NoteRow[]; total: number };

export function useNotesRead(place: Place): BoxRead<Notes> {
  
  return useToolRead<Notes>("list_notes", { node: place.kind === "node" ? place.id : null, limit: 12 });
}

function noteItem(note: NoteRow): Item {
  return {
    id: note.id,
    nodeId: note.nodeId,
    nodePath: note.path,
    parentId: note.parentId,
    type: note.decision ? "decision" : "note",
    title: note.title,
    body: note.body,
    status: "open",
    priority: null,
    dueOn: null,
    source: note.source,
    agentLabel: note.agentLabel,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function NotesBoxContent({ read, place }: { read: BoxRead<Notes>; place: Place }) {
  const { openItem, tree } = useWorkspace();
  const { data, error, stale, retry } = read;
  const node = place.kind === "node" ? place.id : null;
  useBoxSettled(read.settled);
  if (!data) return error ? <BoxFailed what="The notes" message={error} kept={false} onRetry={retry} /> : <BoxWait what="Reading the notes…" rows={2} />;
  return (
    <div className="box-read" data-stale={stale || undefined} aria-busy={stale || undefined}>
      {error && <BoxFailed what="The notes" message={error} kept onRetry={retry} />}
      {data.notes.length === 0 ? (
        <p className="t-help group-empty">{node ? "No notes here yet: a note keeps in view what is not something to do." : "No loose notes yet: write one here, and give it a place later."}</p>
      ) : (
        <ul className="note-list">
          {data.notes.map((note) => {
            
            const where = placeOnPage({ nodeId: note.nodeId, path: note.path }, note.path !== null, node, tree);
            return (
              <li key={note.id} className="note-row" data-item={note.id}>
                <button type="button" className="note-open" data-item-title aria-label={`Open “${inlinePlain(note.title)}”`} onClick={() => openItem(noteItem(note))} />
                <span className="note-title">
                  <InlineText text={note.title} />
                </span>
                {note.decision && <span className="pill note-decision">Decision</span>}
                {where.shown && (
                  <span className="note-where">
                    <PlaceName path={where.path} color={note.color} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data.total > data.notes.length && <p className="t-meta">{`The latest ${data.notes.length} of ${data.total}. Search finds the others.`}</p>}
    </div>
  );
}



export function useAddNote(node: string | null) {
  const { saving, notify } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const foldId = useId();

  async function add() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const answer = await tool<{ item: { id: string } }>("add_note", { node, text: value });
    setBusy(false);
    if (!(await saving(Promise.resolve(answer)))) return;
    setText("");
    if (answer.ok) notify({ text: `Added note “${inlinePlain(value)}”`, tone: "status", undo: () => void saving(tool("delete_item", { id: answer.item.id })) });
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void add();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function close() {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  }

  const trigger = (
    <Button
      ref={button}
      variant="quiet"
      size="sm"
      className="head-action"
      aria-expanded={open}
      aria-controls={foldId}
      onClick={() => {
        if (open) return setOpen(false);
        setText("");
        setRound((value) => value + 1);
        setOpen(true);
      }}
    >
      Add note
    </Button>
  );
  const editor = (
    <Fold open={open} id={foldId}>
      {round > 0 && (
        <div key={round} className="task-add-line note-add">
          <Field
            autoFocus
            aria-label="New note"
            placeholder="Write a note, and press Enter"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKey}
            onPaste={(event) => {
              const next = pasteLinkOver(event.currentTarget, event.clipboardData.getData("text"));
              if (next === null) return;
              event.preventDefault();
              setText(next);
            }}
          />
          <Button size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void add()} disabled={!text.trim() || busy}>
            Add note
          </Button>
        </div>
      )}
    </Fold>
  );
  return { trigger, editor };
}



type Updates = { created: Item[]; changed: Item[]; completed: Item[]; deleted: Item[] };

type Snapshot = { title: string; body: string | null; status: "open" | "done"; priority: number | null; due_on: string | null; due_time: string | null; parent_item_id: string | null };
type Revision = { id: string; createdAt: string; source: Item["source"]; agentLabel: string | null; snapshot: Snapshot };

type Entry = {
  key: string;
  at: string;
  what: string;
  title: string;
  undo: () => Promise<{ ok: boolean; message?: string }>;
  
  open?: () => void;
};

const ACTIVITY_DAYS = 7;

function actor(source: Item["source"], label: string | null): string {
  if (source === "chat") return "The chat";
  return label ? `The agent “${label}”` : "An agent";
}

const TYPE_WORD: Record<Item["type"], string> = { task: "a task", note: "a note", decision: "a decision" };

export function ActivityBoxContent({ place }: { place: Place }) {
  const { openItem, saving, chat } = useWorkspace();
  const [all, setAll] = useState(false);
  const [since] = useState(() => new Date(Date.now() - ACTIVITY_DAYS * 86_400_000));
  const sinceIso = since.toISOString();
  const updates = useToolRead<Updates>("get_updates_since", { since: sinceIso, ...(place.kind === "node" ? { node: place.id } : {}) });

  const entries = useMemo(() => {
    const list: Entry[] = [];
    if (updates.data) {
      const kinds = [
        ["created", "added"],
        ["completed", "completed"],
        ["changed", "changed"],
        ["deleted", "deleted"],
      ] as const;
      for (const [kind, verb] of kinds) {
        for (const item of updates.data[kind]) {
          
          const changedByOther = kind === "created" && item.source === "manual" && (item.changedSource === "chat" || item.changedSource === "agent");
          const as = changedByOther ? "changed" : kind;
          const who = as === "created" ? item.source : (item.changedSource ?? item.source);
          const label = as === "created" ? item.agentLabel : (item.changedAgentLabel ?? null);
          
          if (who !== "chat" && who !== "agent") continue;
          if (place.kind === "general" && item.nodeId !== null) continue;
          list.push({
            key: `${as}:${item.id}`,
            at: as === "created" ? item.createdAt : as === "completed" ? (item.completedAt ?? item.updatedAt ?? item.createdAt) : (item.updatedAt ?? item.createdAt),
            what: `${actor(who, label)} ${changedByOther ? "changed" : verb} ${TYPE_WORD[item.type]}`,
            title: item.title,
            undo: () => undoUpdate(as, item, who, label),
            open: kind === "deleted" ? undefined : () => openItem(item),
          });
        }
      }
    }
    return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [updates.data, place, openItem]);

  const failed = updates.error;
  useBoxSettled(updates.settled);
  if (!updates.data) {
    if (failed) return <BoxFailed what="The activity" message={failed} kept={false} onRetry={updates.retry} />;
    return <BoxWait what="Reading what the chat and the agents did…" rows={3} />;
  }
  return (
    <div className="box-read" data-stale={updates.stale || undefined}>
      {failed && <BoxFailed what="The activity" message={failed} kept onRetry={updates.retry} />}
      {entries.length === 0 ? (
        <BoxEmpty text={`Nothing done by the chat or an agent in the last ${count(ACTIVITY_DAYS, "day", "days")}.`} reason="no-activity">
          <Button size="sm" onClick={() => chat.setOpen(true)}>
            Open the chat
          </Button>
        </BoxEmpty>
      ) : (
        <>
          <ol className="activity-list" id="activity-entries">
            {entries.slice(0, all ? entries.length : FIRST_SHOWN).map((entry) => (
              <li key={entry.key} className="activity-entry" data-activity={entry.key.split(":")[0]}>
                <span className="activity-what">{entry.what}</span>
                <Button size="sm" variant="quiet" className="activity-undo head-action" aria-label={`Undo: ${entry.what}, “${inlinePlain(entry.title)}”`} onClick={() => void saving(entry.undo())}>
                  Undo
                </Button>
                {entry.open ? (
                  <button type="button" className="activity-title" onClick={entry.open}>
                    {inlinePlain(entry.title)}
                  </button>
                ) : (
                  <span className="activity-title activity-title-gone">{inlinePlain(entry.title)}</span>
                )}
              </li>
            ))}
          </ol>
          {entries.length > FIRST_SHOWN && (
            <button type="button" className="task-add" aria-controls="activity-entries" aria-expanded={all} onClick={() => setAll((value) => !value)}>
              {all ? `Show the latest ${FIRST_SHOWN}` : `Show all ${entries.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}




async function undoUpdate(kind: keyof Updates, item: Item, who: Item["source"], label: string | null): Promise<{ ok: boolean; message?: string }> {
  if (kind === "completed") return item.type === "task" ? tool("reopen_task", { task: item.id }) : tool("update_item", { id: item.id, status: "open" });
  if (kind === "deleted") return post(`/api/items/${item.id}/restore`, {});
  const versions = await get<{ revisions: Revision[] }>(`/api/items/${item.id}/revisions`);
  if (!versions.ok) return versions;
  const name = `“${inlinePlain(item.title)}”`;
  const byOther = (revision: Revision) => revision.source !== who || (who === "agent" && revision.agentLabel !== label);
  if (kind === "created") {
    
    if (versions.revisions.some(byOther)) return { ok: false, message: `${name} was changed after it was added, so it stays: delete it from its "More" if it should go.` };
    return tool("delete_item", { id: item.id });
  }
  
  const at = versions.revisions.findIndex((revision) => !byOther(revision));
  if (at < 0) return { ok: false, message: `The version ${name} had before this change is not there to go back to.` };
  const before = versions.revisions[at].snapshot;
  const later = versions.revisions.slice(0, at);
  const current = await tool<{ item: Item }>("get_item", { id: item.id });
  if (!current.ok) return current;
  const now: Snapshot = {
    title: current.item.title,
    body: current.item.body,
    status: current.item.status,
    priority: current.item.priority,
    due_on: current.item.dueOn,
    due_time: current.item.dueTime ?? null,
    parent_item_id: current.item.parentId,
  };
  
  const after = later.at(-1)?.snapshot ?? now;
  const hour = (value: string | null) => value?.slice(0, 5) ?? null;
  const same = (field: keyof Snapshot, a: Snapshot, b: Snapshot) => (field === "due_time" ? hour(a[field]) === hour(b[field]) : a[field] === b[field]);
  const fields = (["title", "body", "status", "priority", "due_on", "due_time", "parent_item_id"] as const).filter((field) => !same(field, before, after));
  if (fields.length === 0) return { ok: false, message: `${name} reads as it did before this change: there is nothing to undo.` };
  const touched = fields.filter((field) => !same(field, after, now));
  if (touched.length > 0) return { ok: false, message: `${name} was changed again since, so it stays as it is: open it and go back from its "Versions".` };
  if (fields.includes("parent_item_id")) return { ok: false, message: `This change moved ${name}: open it and go back from its "Versions".` };
  const note = item.type !== "task";
  const input: Record<string, unknown> = { id: item.id };
  if (fields.includes("title") && !note) input.title = before.title;
  if (fields.includes("body") || (note && fields.includes("title"))) input.notes = before.body;
  if (fields.includes("status")) input.status = before.status;
  if (fields.includes("priority")) input.priority = before.priority;
  if (fields.includes("due_on")) input.dueOn = before.due_on;
  if (fields.includes("due_time") && before.due_on) input.dueTime = hour(before.due_time);
  return tool("update_item", input);
}
