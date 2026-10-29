"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, ViewTransition } from "react";
import { Menu } from "@/components/ui/menu";
import { firstWeekday, longDay, today } from "@/lib/dates";
import {
  ActivityBoxContent,
  CalendarBoxContent,
  MailBoxContent,
  NoDateBoxContent,
  NotesBoxContent,
  placeInput,
  placeValue,
  TasksBoxContent,
  tasksCount,
  useNotesRead,
  useTasksRead,
  type MailList,
} from "./box-kinds";
import { BoxBoard, customizeEntries, SPLIT, useBoardLayout, useToolRead, type BoardLayout, type BoxSpec } from "./boxes";
import { GoogleOutcome } from "./node-view";
import { PageHeader } from "./page-header";
import { MailAccountFilter, TasksPlaceFilter, useAddress, usePlaceParam } from "./page-filters";
import { useChatScope, useWorkspace } from "./workspace";

// The Overview's boxes, in their first order: the tasks and what happened on the left, the week, the mail, what has no
// date and the notes on the right.
export const OVERVIEW_BOXES = ["tasks", "activity", SPLIT, "calendar", "mail", "no_date", "notes"];

const NAMES: Record<string, string> = { tasks: "Tasks", calendar: "Calendar", mail: "Mail", no_date: "No date", activity: "Activity", notes: "Notes" };

const noSubscription = () => () => {};

// The Overview: boxes the person orders, over everything or one place, and one mail account.
export function Overview({ saved }: { saved: BoardLayout | null }) {
  // The day, the week's first day and the dates are the browser's: the server's zone never paints them.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { tree } = useWorkspace();
  useChatScope(null);
  const board = useBoardLayout("overview", OVERVIEW_BOXES, saved);
  const { set } = useAddress();
  const router = useRouter();
  const place = usePlaceParam(tree);
  const account = useSearchParams().get("account");
  const google = useSearchParams().get("google");
  const [weekStart] = useState(() => (typeof window === "undefined" ? 1 : firstWeekday()));
  const now = mounted ? today() : null;

  const tasks = useTasksRead(place, now, { upcomingDays: 3 });
  const notes = useNotesRead(place);
  // One read for the Mail box, so another account or place repaints over what it showed instead of starting empty; the
  // account filter's options read the place's every account apart only while one account is chosen.
  const mail = useToolRead<MailList>("list_mail", { ...placeInput(place), ...(account ? { account } : {}), limit: 50 });
  const everyAccount = useToolRead<MailList>("list_mail", account ? { ...placeInput(place), limit: 50 } : null);
  const mailOfPlace = account ? everyAccount : mail;

  const query = placeValue(place);
  const tasksHref = `/app/tasks${query ? `?place=${query}` : ""}`;
  const calendarHref = place.kind === "node" ? `/app/calendar?scope=${place.id}` : "/app/calendar";
  const placeId = place.kind === "node" ? place.id : null;

  const boxes: Record<string, BoxSpec> = now
    ? {
        tasks: {
          id: "tasks",
          title: NAMES.tasks,
          count: tasksCount(tasks.data),
          menu: [{ kind: "action", label: "Open Tasks", onSelect: () => router.push(tasksHref) }],
          content: <TasksBoxContent read={tasks} now={now} place={place} placeId={placeId} showPlace layout="list" allHref={tasksHref} />,
        },
        calendar: {
          id: "calendar",
          title: NAMES.calendar,
          content: <CalendarBoxContent place={place} now={now} weekStart={weekStart} tasks={allTasks(tasks.data)} calendarHref={calendarHref} />,
        },
        mail: {
          id: "mail",
          title: NAMES.mail,
          count: mail.data ? `${mail.data.unread} unread` : undefined,
          content: <MailBoxContent read={mail} now={now} place={place} connectHref="/app/settings#google-accounts" />,
        },
        no_date: {
          id: "no_date",
          title: NAMES.no_date,
          count: tasks.data?.groups.noDate.count,
          content: <NoDateBoxContent read={tasks} placeId={placeId} showPlace />,
        },
        activity: { id: "activity", title: NAMES.activity, content: <ActivityBoxContent place={place} /> },
        notes: { id: "notes", title: NAMES.notes, count: notes.data?.total, content: <NotesBoxContent read={notes} place={place} /> },
      }
    : {};

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-boxes" data-overview data-today={now ?? undefined}>
        <PageHeader
          title="Overview"
          count={now ? longDay(now) : <span className="page-count-wait" aria-hidden="true" />}
          filters={
            <>
              <TasksPlaceFilter place={place} onChange={(next) => set({ place: placeValue(next), account: null })} tree={tree} now={now} />
              <MailAccountFilter account={account} onChange={(next) => set({ account: next })} mail={mailOfPlace.data} />
            </>
          }
          chat
          more={<Menu label="More" about="for the Overview" entries={customizeEntries(board, NAMES)} />}
        />
        {google && <GoogleOutcome outcome={google} />}
        {now ? <BoxBoard board={board} boxes={boxes} label="The Overview's boxes" /> : <BoardShell />}
      </div>
    </ViewTransition>
  );
}

// Every task the page holds, for a day of the week to take one dropped on it.
export function allTasks(view: ReturnType<typeof useTasksRead>["data"]) {
  if (!view) return [];
  return [...view.groups.overdue.tasks, ...view.groups.today.tasks, ...view.groups.upcoming.days.flatMap((day) => day.tasks), ...view.groups.noDate.tasks];
}

// Before the browser knows the day, the boxes' place is already held, so nothing below moves when they arrive.
export function BoardShell() {
  return (
    <div className="boxes" aria-busy="true">
      <p className="boxes-wait t-meta" role="status">
        Reading your workspace…
      </p>
    </div>
  );
}
