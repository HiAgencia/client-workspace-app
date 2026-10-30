"use client";

import Link from "next/link";
import { useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { addDays, instantsOf, LOCALE, longDay, weekOf, type Day } from "@/lib/dates";
import { inlinePlain } from "@/lib/inline-links";
import type { MailRow } from "@/lib/tools/mail-schema";
import type { NoteRow } from "@/lib/tools/notes";
import type { TasksView } from "@/lib/tools/tasks";
import { buttonClass } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { BoxEmpty, BoxFailed, BoxWait, useBoxRead, useBoxSettled, useToolRead, type BoxRead } from "./boxes";
import { get, post, tool, type CalendarEvent, type EventsFailure, type Item, type TreeNode } from "./client-api";
import { PathText } from "./item-parts";
import { subjectOf } from "./mail/subject";
import { branchOf } from "./place-filters";
import { QuickAddInline } from "./quick-add";
import { NewNode } from "./side-nav";
import { count } from "./count";
import { dayHeading, dayName, InlineText, openTaskDetail, pasteLinkOver, PlaceName, TaskList, timeLabel, useTaskActions, type TaskData } from "./task-row";
import { useWorkspace } from "./workspace";

// The boxes the Overview and a client's or a project's page compose, each reading its own data for the place the page
// shows, and the groups of tasks the Tasks page shows whole.

// ---- The place a page shows ------------------------------------------------------------------------------------------

export type Place = { kind: "all" } | { kind: "general" } | { kind: "node"; id: string };

// What a tool reads for a place: everything, General alone (null), or a node and what is below it.
export function placeInput(place: Place): Record<string, unknown> {
  if (place.kind === "all") return {};
  if (place.kind === "general") return { node: null };
  return { node: place.id };
}

// The place in the address: `general`, a node's id, or nothing for every place. An unknown value is dropped.
export function readPlace(value: string | null, tree: TreeNode[] | null): Place {
  if (value === "general") return { kind: "general" };
  if (value && /^[0-9a-f-]{36}$/.test(value) && (!tree || tree.some((node) => node.id === value))) return { kind: "node", id: value };
  return { kind: "all" };
}

export function placeValue(place: Place): string | null {
  return place.kind === "all" ? null : place.kind === "general" ? "general" : place.id;
}

function inPlace(place: Place, tree: TreeNode[] | null, nodeId: string | null): boolean {
  if (place.kind === "all") return true;
  if (place.kind === "general") return nodeId === null;
  return nodeId !== null && branchOf(tree, place.id).has(nodeId);
}

// ---- The tasks' groups: Overdue, Today, Upcoming day by day, and No date ----------------------------------------------

export type Sort = "date" | "priority" | "manual";

type GroupsProps = {
  view: TasksView;
  now: Day;
  // A box shows the nearest days of Upcoming and leaves No date to its own box; the Tasks page shows every group whole.
  mode: "box" | "page";
  layout: "list" | "board";
  // Where a task added at a group's foot goes: the page's node, or General (null).
  placeId: string | null;
  // What «Reschedule» moves: the overdue tasks of the place in view.
  place: Place;
  showPlace: boolean;
  // The node whose page shows the groups: a task of its own says no place, one below it its path from there.
  pageNode?: string | null;
  sort?: Sort;
  // Where «Show all upcoming» goes.
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
  // The day a task added at its foot takes; undefined when nothing is added there.
  add?: Day | null;
  empty: string;
  // Upcoming's days, each a list of its own.
  days?: Group[];
  action?: ReactNode;
};

export function TaskGroups({ view, now, mode, layout, placeId, place, showPlace, pageNode, sort = "date", allHref }: GroupsProps) {
  const manual = sort === "manual";
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
      // A task is never born late: the group's foot adds it for today.
      add: mode === "page" ? now : undefined,
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
      add: mode === "box" ? addDays(now, 1) : undefined,
      empty: "Nothing is coming up.",
      days: upcomingDays,
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
  // An empty Overdue has nothing to act on, and takes no task: it does not show.
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
      {shown.map((group) => (
        <section key={group.key} className="group" data-group={group.key} aria-labelledby={`group-${group.key}`}>
          <div className="group-head">
            <h3 id={`group-${group.key}`} className="group-title" data-when={group.tone}>
              {group.label}
            </h3>
            {group.count > 0 && <span className="group-count">{group.count}</span>}
            {group.action && <div className="group-action">{group.action}</div>}
          </div>
          {group.days ? (
            <>
              {group.days.length === 0 && <p className="t-help group-empty">{group.empty}</p>}
              {group.days.map((day) => (
                <div key={day.key} className="group-day" data-day={day.key}>
                  <h4 className="group-day-title" data-when={day.tone}>
                    {day.label}
                  </h4>
                  {list(day)}
                  {day.add !== undefined && <QuickAddInline day={day.add} placeId={placeId} />}
                </div>
              ))}
              {mode === "box" && view.groups.upcoming.hidden > 0 && allHref && (
                <Link className="link group-more" href={allHref}>
                  Show all upcoming
                </Link>
              )}
            </>
          ) : (
            <>
              {list(group)}
              {group.tasks.length === 0 && <p className="t-help group-empty">{group.empty}</p>}
            </>
          )}
          {group.add !== undefined && <QuickAddInline day={group.add} placeId={placeId} />}
        </section>
      ))}
    </div>
  );
}

// «Reschedule»: every overdue task of the place in view to one day, each keeping its hour, with its undo.
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
  return <DatePicker look="chip" className="reschedule" label={`Reschedule the ${count(overdue, "overdue task", "overdue tasks")}`} value={null} display="Reschedule" onChange={(day) => void move(day)} />;
}

// The tasks of a place for the person's day, read once for the boxes that show them.
export function useTasksRead(place: Place, now: Day | null, extra: Record<string, unknown> = {}): BoxRead<TasksView> {
  return useToolRead<TasksView>("get_tasks", now ? { ...placeInput(place), today: now, ...extra } : null);
}

// The Tasks box: Overdue, Today, and the nearest days of Upcoming, with the way to all of it.
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

export function tasksCount(view: TasksView | null): number | undefined {
  if (!view) return undefined;
  return view.groups.overdue.count + view.groups.today.count + view.groups.upcoming.count;
}

// What the box's number counts: the open tasks that have a date —the ones its groups show—, said in words, because the
// page's own figure counts every open task, the undated ones included, and two bare numbers over the same word read as a
// contradiction.
export function tasksCountLabel(view: TasksView | null): string | undefined {
  const dated = tasksCount(view);
  return dated === undefined ? undefined : `${dated} scheduled`;
}

// The No date box: the tasks without a day, in the order the person drags them into.
export function NoDateBoxContent({ read, placeId, showPlace, pageNode }: { read: BoxRead<TasksView>; placeId: string | null; showPlace: boolean; pageNode?: string | null }) {
  const { data, error, stale, retry } = read;
  useBoxSettled(read.settled);
  if (!data) return error ? <BoxFailed what="The tasks without a date" message={error} kept={false} onRetry={retry} /> : <BoxWait what="Reading the tasks without a date…" rows={2} />;
  const group = data.groups.noDate;
  return (
    <div className="box-read" data-stale={stale || undefined} aria-busy={stale || undefined}>
      {error && <BoxFailed what="The tasks without a date" message={error} kept onRetry={retry} />}
      <TaskList group="noDate" label="No date" tasks={group.tasks} showPlace={showPlace} pageNode={pageNode} dropDay={null} reorderable />
      {group.tasks.length === 0 && <p className="t-help group-empty">Nothing waits without a date. One added here stays without one, in the order you give it.</p>}
      <QuickAddInline day={null} placeId={placeId} />
    </div>
  );
}

// ---- Calendar: the week, with the chosen day below ----------------------------------------------------------------

type Event = CalendarEvent & { origin: "google" | "local"; localId: string | null; nodeId: string | null; nodePath: string | null; linkedNodeIds: string[] };
type Events = { events: Event[]; failures: EventsFailure[] };

function onDay(event: Event, day: Day): boolean {
  if (event.allDay) {
    // A Google whole day ends the next day; the workspace's own says its last day.
    const last = event.origin === "google" ? addDays(event.end.slice(0, 10), -1) : event.end.slice(0, 10);
    return event.start.slice(0, 10) <= day && day <= last;
  }
  const start = Date.parse(event.start);
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const dayEnd = new Date(`${addDays(day, 1)}T00:00:00`).getTime();
  return start < dayEnd && (Date.parse(event.end) > dayStart || start >= dayStart);
}

// The task being dragged anywhere on the page, so a day of the week takes it.
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
  const read = useToolRead<Events>("browse_events", {
    ...(place.kind === "node" ? { node: place.id } : {}),
    from: instants.from,
    to: instants.to,
    fromDay: week.from,
    toDay: week.to,
  });
  const [chosen, setChosen] = useState<Day>(now);
  const [over, setOver] = useState<Day | null>(null);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.from, index));
  // General shows the workspace's own events of no client or project.
  const events = (read.data?.events ?? []).filter((event) => place.kind !== "general" || (event.origin === "local" && event.nodeId === null));
  const ofDay = (day: Day) => events.filter((event) => onDay(event, day));
  const names = new Map((tree ?? []).map((node) => [node.id, node.path]));
  useBoxSettled(read.settled);

  function onDrop(event: DragEvent<HTMLElement>, day: Day) {
    setOver(null);
    const task = tasks.find((entry) => entry.id === draggedTask);
    if (!task) return;
    event.preventDefault();
    const group = day < now ? "overdue" : day === now ? "today" : day;
    void actions.moveToDay(task, day, group, dayName(day, now));
  }

  if (!read.data && read.error) return <BoxFailed what="The calendar" message={read.error} kept={false} onRetry={read.retry} />;
  if (!read.data) return <BoxWait what="Reading this week's events…" rows={2} />;
  const chosenEvents = ofDay(chosen);
  return (
    <div className="box-read" data-stale={read.stale || undefined} aria-busy={read.stale || undefined}>
      {read.error && <BoxFailed what="The calendar" message={read.error} kept onRetry={read.retry} />}
      {/* The calendars that could not be read, one line per reason, naming each account. */}
      {[...new Set(read.data.failures.map((failure) => failure.reason))].map((reason) => {
        const who = read.data!.failures.filter((failure) => failure.reason === reason).map((failure) => failure.accountEmail || "The workspace's calendar");
        return (
          <p key={reason} className="inline-note" data-tone="alert">
            {`${who.length === 1 ? who[0] : count(who.length, "calendar", "calendars")} could not be read: ${reason}.`}
            {who.length > 1 && <span className="calendar-failed-who">{who.join(", ")}</span>}
          </p>
        );
      })}
      <div className="week" role="group" aria-label={`The week of ${longDay(week.from)}`}>
        {days.map((day) => {
          const many = ofDay(day).length;
          const date = new Date(`${day}T00:00:00`);
          // The name starts with what the day shows («Mon 26»), so whoever speaks what they see reaches it; the rest follows.
          const shown = `${new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(date)} ${date.getDate()}`;
          return (
            <button
              key={day}
              type="button"
              className="week-day"
              data-day={day}
              aria-pressed={day === chosen}
              aria-current={day === now ? "date" : undefined}
              aria-label={`${shown}, ${longDay(day)}, ${count(many, "event", "events")}`}
              data-over={over === day || undefined}
              onClick={() => setChosen(day)}
              onDragOver={(event) => {
                if (!draggedTask) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (over !== day) setOver(day);
              }}
              onDragLeave={() => setOver((value) => (value === day ? null : value))}
              onDrop={(event) => onDrop(event, day)}
            >
              <span className="week-name">{shown.split(" ")[0]}</span>{" "}
              <span className="week-number">{date.getDate()}</span>
              <span className="week-mark" data-some={many > 0 || undefined} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="day-events">
        <h3 className="group-title" data-when={chosen === now ? "today" : undefined}>
          {chosen === now ? "Today" : dayHeading(chosen, now)}
        </h3>
        {chosenEvents.length === 0 ? (
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
      {chosenEvents.length > 0 && (
        <Link className="link box-foot-link" href={calendarHref}>
          Open the calendar
        </Link>
      )}
    </div>
  );
}

// ---- Mail: first what a task waits for, then what is unread -------------------------------------------------------

export type MailList = {
  accounts: Array<{ id: string; email: string; isDemo: boolean; status: string; nodeId: string | null }>;
  groups: Record<"forTasks" | "unread" | "earlier", { count: number; messages: MailRow[] }>;
  unread: number;
  failures: Array<{ accountId: string; accountEmail: string; reason: string }>;
};

export function useMailRead(place: Place, account: string | null): BoxRead<MailList> {
  return useToolRead<MailList>("list_mail", { ...placeInput(place), ...(account ? { account } : {}), limit: 50 });
}

const MAIL_ROWS = 5;

function mailWhen(iso: string, now: Day): string {
  const date = new Date(iso);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const time = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" }).format(date);
  return day === now ? time : dayName(day, now);
}

export function MailBoxContent({ read, now, place, connectHref }: { read: BoxRead<MailList>; now: Day; place: Place; connectHref: string }) {
  const { data, error, stale, retry } = read;
  useBoxSettled(read.settled);
  if (!data) return error ? <BoxFailed what="The mail" message={error} kept={false} onRetry={retry} /> : <BoxWait what="Reading the mail…" rows={3} />;
  const rows = [...data.groups.forTasks.messages, ...data.groups.unread.messages.filter((message) => !data.groups.forTasks.messages.some((other) => other.id === message.id))].slice(0, MAIL_ROWS);
  const body = () => {
    if (data.accounts.length === 0) {
      return place.kind === "general" ? (
        <BoxEmpty text="General has no mail account: the mail lives in the accounts of each client and project." reason="general">
          <Link className={buttonClass({ size: "sm" })} href="/app/mail">
            <span className="btn-label">Show all mail</span>
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
      return (
        <BoxEmpty text="Nothing unread, and no task waits for a message." reason="nothing-unread">
          <Link className={buttonClass({ size: "sm" })} href="/app/mail">
            <span className="btn-label">Show all mail</span>
          </Link>
        </BoxEmpty>
      );
    }
    return (
      <>
        <ul className="mail-list">
          {rows.map((message) => {
            const waiting = message.tasks.find((task) => task.status === "open") ?? message.tasks[0];
            return (
              <li key={`${message.accountId}:${message.id}`}>
                <Link className="mail-row" href={`/app/mail?account=${message.accountId}&message=${encodeURIComponent(message.id)}`} data-unread={message.unread || undefined}>
                  <span className="mail-from">{message.from.name || message.from.email}</span>
                  <span className="mail-side">
                    {message.important && <span className="pill mail-important">Important</span>}
                    <span className="mail-when">{mailWhen(message.receivedAt, now)}</span>
                  </span>
                  <span className="mail-subject">{subjectOf(message)}</span>
                  <span className="mail-for">
                    {waiting ? (
                      `For: ${inlinePlain(waiting.title)}`
                    ) : message.place ? (
                      <PlaceName path={message.place.path} color={message.place.color} />
                    ) : (
                      message.accountEmail
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Link className="link box-foot-link" href="/app/mail">
          Show all mail
        </Link>
      </>
    );
  };
  return (
    <div className="box-read" data-stale={stale || undefined} aria-busy={stale || undefined}>
      {error && <BoxFailed what="The mail" message={error} kept onRetry={retry} />}
      {data.failures.map((failure) => (
        <p key={failure.accountId} className="inline-note" data-tone="alert">
          {failure.accountEmail} could not be read: {failure.reason}
        </p>
      ))}
      {body()}
    </div>
  );
}

// ---- Notes: what to keep in view without it being something to do --------------------------------------------------

type Notes = { notes: NoteRow[]; total: number };

export function useNotesRead(place: Place): BoxRead<Notes> {
  // Everything is the notepad of General: the loose notes.
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
  const { openItem } = useWorkspace();
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
          {data.notes.map((note) => (
            <li key={note.id} className="note-row" data-item={note.id}>
              <button type="button" className="note-open" data-item-title aria-label={`Open “${inlinePlain(note.title)}”`} onClick={() => openItem(noteItem(note))} />
              <span className="note-title">
                <InlineText text={note.title} />
              </span>
              {note.decision && <span className="pill note-decision">Decision</span>}
              {note.nodeId !== node && note.path && (
                <span className="note-where">
                  <PlaceName path={note.path} color={note.color} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.total > data.notes.length && <p className="t-meta">{`The latest ${data.notes.length} of ${data.total}. Search finds the others.`}</p>}
      <AddNote node={node} />
    </div>
  );
}

// «Add note»: one line where the person works; a link pasted over selected words stays on them.
function AddNote({ node }: { node: string | null }) {
  const { saving, notify } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

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
      setOpen(false);
      setText("");
    }
  }

  if (!open) {
    return (
      <button type="button" className="task-add" onClick={() => setOpen(true)}>
        Add note
      </button>
    );
  }
  return (
    <div className="task-add-line note-add">
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
      <Button size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" onClick={() => void add()} disabled={!text.trim() || busy}>
        Add note
      </Button>
    </div>
  );
}

// ---- Activity: what the daily review, the chat and an agent did, each with its undo --------------------------------

// What a run of the review did, each action with its task as it reads now (null once the task is gone).
type ReviewTask = { id: string; title: string; nodeId: string | null; path: string | null; status: "open" | "done" };
type ReviewAction = { id: string; reviewId: string; taskId: string; kind: "mail_status" | "complete"; after: Record<string, unknown>; createdAt: string; undoneAt: string | null; task: ReviewTask | null };
type Reviews = { reviews: Array<{ id: string; day: string; actions: ReviewAction[] }> };
type Updates = { created: Item[]; changed: Item[]; completed: Item[]; deleted: Item[] };
// A version: the item's versioned fields as they were before the change that left it, and who made that change.
type Snapshot = { title: string; body: string | null; status: "open" | "done"; priority: number | null; due_on: string | null; due_time: string | null; parent_item_id: string | null };
type Revision = { id: string; createdAt: string; source: Item["source"]; agentLabel: string | null; snapshot: Snapshot };

type Entry = {
  key: string;
  at: string;
  what: string;
  title: string;
  detail?: string | null;
  done: boolean;
  undo: () => Promise<{ ok: boolean; message?: string }>;
  open?: () => void;
  // The item it was about is no longer there.
  gone?: boolean;
};

const ACTIVITY_DAYS = 7;
const FIRST_SHOWN = 5;

function actor(source: Item["source"], label: string | null): string {
  if (source === "chat") return "The chat";
  if (source === "review") return "The daily review";
  return label ? `The agent “${label}”` : "An agent";
}

const TYPE_WORD: Record<Item["type"], string> = { task: "a task", note: "a note", decision: "a decision" };

export function ActivityBoxContent({ place }: { place: Place }) {
  const { tree, openItem, saving, chat } = useWorkspace();
  const [all, setAll] = useState(false);
  const [since] = useState(() => new Date(Date.now() - ACTIVITY_DAYS * 86_400_000));
  const sinceIso = since.toISOString();
  const sinceDay = sinceIso.slice(0, 10);
  const reviews = useBoxRead<Reviews>(() => get<Reviews>(`/api/review?since=${sinceDay}`), `reviews:${sinceDay}`);
  const updates = useToolRead<Updates>("get_updates_since", { since: sinceIso, ...(place.kind === "node" ? { node: place.id } : {}) });

  const entries = useMemo(() => {
    const list: Entry[] = [];
    for (const run of reviews.data?.reviews ?? []) {
      const byTask = new Map<string, ReviewAction[]>();
      for (const action of run.actions) byTask.set(action.taskId, [...(byTask.get(action.taskId) ?? []), action]);
      for (const [taskId, actions] of byTask) {
        // The task as the run's read gives it; one that is gone keeps its entry, saying so.
        const task = actions.find((action) => action.task)?.task ?? null;
        if (task && !inPlace(place, tree, task.nodeId)) continue;
        if (!task && place.kind !== "all") continue;
        const completed = actions.some((action) => action.kind === "complete");
        const sentence = actions.map((action) => action.after.sentence).find((value): value is string => typeof value === "string");
        const open = actions.filter((action) => !action.undoneAt);
        list.push({
          key: `review:${run.id}:${taskId}`,
          at: actions.map((action) => action.createdAt).sort().at(-1)!,
          what: completed ? "The daily review completed a task" : "The daily review read the mail of a task",
          title: task?.title ?? "A task that is no longer here",
          detail: sentence,
          done: open.length === 0,
          // What it completed opens again first, then the mail's state goes back.
          undo: async () => {
            for (const action of [...open].sort((a, b) => Number(b.kind === "complete") - Number(a.kind === "complete"))) {
              const answer = await post(`/api/review/actions/${action.id}/undo`, {});
              if (!answer.ok) return answer;
            }
            return { ok: true };
          },
          open: task ? () => openTaskDetail({ id: task.id, task: { id: task.id, title: task.title, nodeId: task.nodeId, path: task.path, status: task.status } }) : undefined,
          gone: !task,
        });
      }
    }
    if (updates.data) {
      const kinds = [
        ["created", "added"],
        ["completed", "completed"],
        ["changed", "changed"],
        ["deleted", "deleted"],
      ] as const;
      for (const [kind, verb] of kinds) {
        for (const item of updates.data[kind]) {
          // An item the person added inside the window that the chat or an agent changed afterwards reads as that change.
          const changedByOther = kind === "created" && item.source === "manual" && (item.changedSource === "chat" || item.changedSource === "agent");
          const as = changedByOther ? "changed" : kind;
          const who = as === "created" ? item.source : (item.changedSource ?? item.source);
          const label = as === "created" ? item.agentLabel : (item.changedAgentLabel ?? null);
          // What the person did by hand is theirs to remember; the review's own lives in its runs.
          if (who !== "chat" && who !== "agent") continue;
          if (place.kind === "general" && item.nodeId !== null) continue;
          list.push({
            key: `${as}:${item.id}`,
            at: as === "created" ? item.createdAt : as === "completed" ? (item.completedAt ?? item.updatedAt ?? item.createdAt) : (item.updatedAt ?? item.createdAt),
            what: `${actor(who, label)} ${changedByOther ? "changed" : verb} ${TYPE_WORD[item.type]}`,
            title: item.title,
            done: false,
            undo: () => undoUpdate(as, item, who, label),
            open: kind === "deleted" ? undefined : () => openItem(item),
          });
        }
      }
    }
    return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [reviews.data, updates.data, place, tree, openItem]);

  const failed = reviews.error ?? updates.error;
  const loading = (!reviews.data && !reviews.error) || (!updates.data && !updates.error);
  useBoxSettled(!loading || (reviews.settled && updates.settled && Boolean(failed)));
  if (!reviews.data && !updates.data) {
    if (failed) return <BoxFailed what="The activity" message={failed} kept={false} onRetry={() => (reviews.retry(), updates.retry())} />;
    return <BoxWait what="Reading what the review, the chat and the agents did…" rows={3} />;
  }
  if (loading && entries.length === 0) return <BoxWait what="Reading what the review, the chat and the agents did…" rows={3} />;
  return (
    <div className="box-read" data-stale={updates.stale || undefined}>
      {failed && <BoxFailed what="Part of the activity" message={failed} kept onRetry={() => (reviews.retry(), updates.retry())} />}
      {entries.length === 0 ? (
        <BoxEmpty text={`Nothing done by the daily review, the chat, or an agent in the last ${ACTIVITY_DAYS} days.`} reason="no-activity">
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
                {entry.done ? (
                  <span className="activity-undone">Undone</span>
                ) : (
                  <Button size="sm" variant="quiet" className="activity-undo" aria-label={`Undo: ${entry.what}, “${inlinePlain(entry.title)}”`} onClick={() => void saving(entry.undo())}>
                    Undo
                  </Button>
                )}
                {entry.open ? (
                  <button type="button" className="activity-title" onClick={entry.open}>
                    {inlinePlain(entry.title)}
                  </button>
                ) : (
                  <span className="activity-title activity-title-gone" data-gone={entry.gone || undefined}>
                    {inlinePlain(entry.title)}
                  </span>
                )}
                {entry.detail && <span className="activity-detail">{entry.detail}</span>}
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

// Undoing what the chat or an agent did, and only that: an addition is deleted, a completion opens again, a deletion comes
// back, and a change takes back exactly the fields it changed. What someone changed since is never written over: the undo
// says so and leaves the item as it is, with the item's own versions as the way back.
async function undoUpdate(kind: keyof Updates, item: Item, who: Item["source"], label: string | null): Promise<{ ok: boolean; message?: string }> {
  if (kind === "completed") return tool("update_item", { id: item.id, status: "open" });
  if (kind === "deleted") return post(`/api/items/${item.id}/restore`, {});
  const versions = await get<{ revisions: Revision[] }>(`/api/items/${item.id}/revisions`);
  if (!versions.ok) return versions;
  const name = `“${inlinePlain(item.title)}”`;
  const byOther = (revision: Revision) => revision.source !== who || (who === "agent" && revision.agentLabel !== label);
  if (kind === "created") {
    // Every change since it was added leaves a version: one by someone else is theirs to keep.
    if (versions.revisions.some(byOther)) return { ok: false, message: `${name} was changed after it was added, so it stays: delete it from its "More" if it should go.` };
    return tool("delete_item", { id: item.id });
  }
  // The version this change left: the newest one made by whoever made it. What came after it says what it changed.
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
  // Right after this change the item read as the next version's photo, or as it reads now when none came after.
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

// ---- Subprojects: what hangs from a client or a project ------------------------------------------------------------

export function SubprojectsBoxContent({ node, adding, setAdding }: { node: TreeNode; adding: boolean; setAdding: (value: boolean) => void }) {
  const { tree } = useWorkspace();
  const children = (tree ?? []).filter((entry) => entry.parentId === node.id);
  const one = node.kind === "client" ? "project" : "subproject";
  useBoxSettled(true);
  return (
    <div className="box-read">
      {children.length === 0 && !adding && <p className="t-help group-empty">{`No ${one}s in ${node.name} yet.`}</p>}
      {children.length > 0 && (
        <ul className="child-list">
          {children.map((child) => (
            <li key={child.id}>
              <Link className="child-row" href={`/app/node/${child.id}`}>
                <span className="child-name task-place-name" data-color={child.color ?? undefined}>
                  {child.name}
                </span>
                <span className="child-count">{child.openTasks === 0 ? "No open tasks" : count(child.openTasks, "open task", "open tasks")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="child-new">
          <NewNode parent={node} idPrefix="box-new" onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button type="button" className="task-add" data-add-child onClick={() => setAdding(true)}>
          {`Add ${one}`}
        </button>
      )}
    </div>
  );
}
