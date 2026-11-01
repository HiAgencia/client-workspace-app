"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, ViewTransition } from "react";
import { Menu } from "@/components/ui/menu";
import { firstWeekday, longDay, today } from "@/lib/dates";
import {
  ActivityBoxContent,
  allTasks,
  CalendarBoxContent,
  MailBoxContent,
  NoDateBoxContent,
  noDateCount,
  NotesBoxContent,
  notesCount,
  placeInput,
  placeValue,
  TasksBoxContent,
  tasksCountLabel,
  useMailCount,
  useMailRead,
  useNotesRead,
  useTasksRead,
} from "./box-kinds";
import { BoxBoard, customizeEntries, SPLIT, useBoardLayout, type BoardLayout, type BoxSpec } from "./boxes";
import { GoogleOutcome } from "./node-view";
import { PageHeader } from "./page-header";
import { MailAccountFilter, TasksPlaceFilter, useAddress, usePlaceParam } from "./page-filters";
import { ReplyStrip } from "./reply-strip";
import { useTaskReplies } from "./task-replies";
import { useChatScope, useWorkspace } from "./workspace";



export const OVERVIEW_BOXES = ["tasks", "activity", SPLIT, "calendar", "mail", "no_date", "notes"];

const NAMES: Record<string, string> = { tasks: "Tasks", calendar: "Calendar", mail: "Mail", no_date: "No date", activity: "Activity", notes: "Notes" };

const noSubscription = () => () => {};



export function Overview({ saved }: { saved: BoardLayout | null }) {
  
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
  
  
  const mail = useMailRead(place, account);
  const mailCount = useMailCount(mail);
  const mailOfPlace = useMailRead(place, null);
  
  
  const replies = useTaskReplies(placeInput(place), now, tree, 5);

  const query = placeValue(place);
  const tasksHref = `/app/tasks${query ? `?place=${query}` : ""}`;
  const calendarHref = place.kind === "node" ? `/app/calendar?scope=${place.id}` : "/app/calendar";
  const placeId = place.kind === "node" ? place.id : null;

  const boxes: Record<string, BoxSpec> = now
    ? {
        tasks: {
          id: "tasks",
          title: NAMES.tasks,
          purpose: "What is overdue and what is for today",
          count: tasksCountLabel(tasks.data),
          menu: [{ kind: "action", label: "Open Tasks", onSelect: () => router.push(tasksHref) }],
          content: <TasksBoxContent read={tasks} now={now} place={place} placeId={placeId} showPlace layout="list" allHref={tasksHref} />,
        },
        calendar: {
          id: "calendar",
          title: NAMES.calendar,
          purpose: "This week in your connected calendars",
          content: <CalendarBoxContent place={place} now={now} weekStart={weekStart} tasks={allTasks(tasks.data)} calendarHref={calendarHref} />,
        },
        mail: {
          id: "mail",
          title: NAMES.mail,
          purpose: "What may answer your tasks, then what is unread",
          count: mailCount,
          content: <MailBoxContent read={mail} replies={replies} account={account} now={now} place={place} connectHref="/app/settings#google-accounts" />,
        },
        no_date: {
          id: "no_date",
          title: NAMES.no_date,
          purpose: "Tasks you can do whenever",
          surface: "rest",
          count: noDateCount(tasks.data),
          content: <NoDateBoxContent read={tasks} placeId={placeId} showPlace />,
        },
        activity: {
          id: "activity",
          title: NAMES.activity,
          purpose: "What the chat and your agents did, each with its undo",
          surface: "rest",
          content: <ActivityBoxContent place={place} />,
        },
        notes: {
          id: "notes",
          title: NAMES.notes,
          purpose: "Loose notes, before they find their place",
          surface: "rest",
          count: notesCount(notes.data?.total),
          content: <NotesBoxContent read={notes} place={place} />,
        },
      }
    : {};

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-boxes" data-overview data-today={now ?? undefined}>
        <PageHeader
          title="Overview"
          count={now ? `${longDay(now)}. What is due, what is on the calendar and what arrived.` : <span className="page-count-wait" aria-hidden="true" />}
          filters={
            <>
              <TasksPlaceFilter place={place} onChange={(next) => set({ place: placeValue(next), account: null })} tree={tree} now={now} />
              <MailAccountFilter account={account} onChange={(next) => set({ account: next })} mail={mailOfPlace.data} replies={replies.data?.tasks ?? []} />
            </>
          }
          filtersSet={(place.kind === "all" ? 0 : 1) + (account ? 1 : 0)}
          chat
          more={<Menu label="More" about="for the Overview" entries={customizeEntries(board, NAMES)} />}
        />
        {google && <GoogleOutcome outcome={google} />}
        <ReplyStrip read={replies} now={now} />
        {now ? <BoxBoard board={board} boxes={boxes} label="The Overview's boxes" /> : <BoardShell />}
      </div>
    </ViewTransition>
  );
}


export function BoardShell() {
  return (
    <div className="boxes" aria-busy="true">
      <p className="boxes-wait t-meta" role="status">
        Reading your workspace…
      </p>
    </div>
  );
}
