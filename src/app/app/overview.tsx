"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, ViewTransition } from "react";
import { Menu } from "@/components/ui/menu";
import { firstWeekday, longDay, today } from "@/lib/dates";
import { ASSISTANT_NAME } from "@/lib/product";
import {
  ActivityBoxContent,
  allTasks,
  CalendarBoxContent,
  HeadLink,
  MailBoxContent,
  NoDateBoxContent,
  noDateCount,
  NotesBoxContent,
  notesCount,
  placeInput,
  placeValue,
  TasksBoxContent,
  tasksCountLabel,
  useAddNote,
  useMailCount,
  useMailRead,
  useNotesRead,
  useTasksRead,
} from "./box-kinds";
import { FOOT, SPLIT, type BoardLayout } from "./board-layout";
import { BoxBoard, customizeEntries, useBoardLayout, type BoxSpec } from "./boxes";
import { useGuide } from "./guide";
import { useGoogleOutcome } from "./google-outcome";
import { PageHeader } from "./page-header";
import { useQuickAddInline } from "./quick-add";
import { MailAccountFilter, TasksPlaceFilter, useAddress, usePlaceParam } from "./page-filters";
import { ReplyStrip } from "./reply-strip";
import { useTaskReplies } from "./task-replies";
import { ConnectOffer, connectWords, useConnectWay } from "./connect-offer";
import { isFirstUse } from "./first-use";
import { settledInBrowser } from "./started";
import { Welcome } from "./welcome";
import { useChatScope, useWorkspace, type Person } from "./workspace";



export const OVERVIEW_BOXES = ["tasks", SPLIT, "calendar", "mail", FOOT, "no_date", "notes", "activity"];

const NAMES: Record<string, string> = { tasks: "Tasks", calendar: "Calendar", mail: "Mail", no_date: "No date", activity: "Activity", notes: "Notes" };

const noSubscription = () => () => {};




export function Overview({ saved, settled = false }: { saved: BoardLayout | null; settled?: boolean }) {
  const { tree, generalTasks, notePlaces, person } = useWorkspace();
  useGoogleOutcome();
  const empty = isFirstUse({ tree, generalTasks, notePlaces });
  
  if (empty && person === null) return <BoardShell />;
  if (empty && person && !person.isAnonymous) return <FirstUse person={person} />;
  return <OverviewBoard saved={saved} settled={settled} />;
}



function FirstUse({ person }: { person: Person }) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-first-use" data-overview data-first-use>
        <PageHeader title="Overview" count={mounted ? longDay(today()) : <span className="page-count-wait" aria-hidden="true" />} />
        <Welcome person={person} />
      </div>
    </ViewTransition>
  );
}



function OverviewBoard({ saved, settled: fromServer }: { saved: BoardLayout | null; settled: boolean }) {
  
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { tree } = useWorkspace();
  
  const settled = useSyncExternalStore(noSubscription, settledInBrowser, () => fromServer);
  const deciding = tree === null && !settled;
  useChatScope(null);
  const board = useBoardLayout("overview", OVERVIEW_BOXES, saved);
  const connectWay = useConnectWay();
  
  const guide = useGuide(tree !== null && tree.length > 0);
  const { set } = useAddress();
  const router = useRouter();
  const place = usePlaceParam(tree);
  const account = useSearchParams().get("account");
  const [weekStart] = useState(() => (typeof window === "undefined" ? 1 : firstWeekday()));
  const now = mounted ? today() : null;

  const tasks = useTasksRead(place, now, { upcomingDays: 3 });
  const notes = useNotesRead(place);
  
  
  const mail = useMailRead(place, account);
  const mailCount = useMailCount(mail);
  const mailOfPlace = useMailRead(place, null);
  
  
  const replies = useTaskReplies(placeInput(place), now, tree, 5);
  const placeId = place.kind === "node" ? place.id : null;
  const noDateAdd = useQuickAddInline({ day: null, placeId });
  const noteAdd = useAddNote(placeId);

  const query = placeValue(place);
  const tasksHref = `/app/tasks${query ? `?place=${query}` : ""}`;
  const calendarHref = `/app/calendar${query ? `?place=${query}` : ""}`;

  const boxes: Record<string, BoxSpec> = now
    ? {
        tasks: {
          id: "tasks",
          title: NAMES.tasks,
          purpose: "Overdue, today and the days ahead",
          count: tasksCountLabel(tasks.data),
          action: (
            <HeadLink href={tasksHref} name="Open all tasks">
              Open
            </HeadLink>
          ),
          menu: [{ kind: "action", label: "Go to Tasks", onSelect: () => router.push(tasksHref) }],
          content: <TasksBoxContent read={tasks} now={now} place={place} placeId={placeId} showPlace layout="list" allHref={tasksHref} />,
        },
        calendar: {
          id: "calendar",
          title: NAMES.calendar,
          purpose: "This week in your connected calendars",
          action: (
            <HeadLink href={calendarHref} name="Open the calendar">
              Open
            </HeadLink>
          ),
          content: <CalendarBoxContent place={place} now={now} weekStart={weekStart} tasks={allTasks(tasks.data)} calendarHref={calendarHref} />,
        },
        mail: {
          id: "mail",
          title: NAMES.mail,
          purpose: "What may answer your tasks, then what is unread",
          count: mailCount,
          action: (
            <HeadLink href="/app/mail" name="Open all mail">
              Open
            </HeadLink>
          ),
          content: (
            <MailBoxContent
              read={mail}
              replies={replies}
              account={account}
              now={now}
              place={place}
              connectHref="/app/settings#accounts-settings"
              connect={<ConnectOffer way={connectWay} quiet />}
              connectText={connectWords(connectWay, "its mail")}
            />
          ),
        },
        no_date: {
          id: "no_date",
          title: NAMES.no_date,
          purpose: "Tasks you can do whenever",
          surface: "rest",
          count: noDateCount(tasks.data),
          action: noDateAdd.trigger,
          unfold: noDateAdd.editor,
          content: <NoDateBoxContent read={tasks} showPlace />,
        },
        activity: {
          id: "activity",
          title: NAMES.activity,
          purpose: `What ${ASSISTANT_NAME} and your coding agents did`,
          surface: "rest",
          content: <ActivityBoxContent place={place} />,
        },
        notes: {
          id: "notes",
          title: NAMES.notes,
          purpose: "Notes in General",
          surface: "rest",
          count: notesCount(notes.data?.total),
          action: noteAdd.trigger,
          unfold: noteAdd.editor,
          content: <NotesBoxContent read={notes} place={place} />,
        },
      }
    : {};

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      {}
      <div className="page page-boxes" data-overview data-today={now ?? undefined} data-deciding={deciding || undefined}>
        <PageHeader
          title="Overview"
          count={now ? longDay(now) : <span className="page-count-wait" aria-hidden="true" />}
          filters={
            <>
              <TasksPlaceFilter place={place} onChange={(next) => set({ place: placeValue(next), account: null })} tree={tree} now={now} />
              <MailAccountFilter account={account} onChange={(next) => set({ account: next })} mail={mailOfPlace.data} replies={replies.data?.tasks ?? []} />
            </>
          }
          filtersSet={(place.kind === "all" ? 0 : 1) + (account ? 1 : 0)}
          chat
          more={<Menu label="More" about="for the Overview" entries={[...customizeEntries(board, NAMES), { kind: "separator" }, { kind: "action", label: "Show the guide", onSelect: guide.start }]} />}
        />
        <ReplyStrip read={replies} now={now} />
        {now ? <BoxBoard board={board} boxes={boxes} label="The Overview's boxes" hold={deciding} /> : <BoardShell />}
        {guide.layer}
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
