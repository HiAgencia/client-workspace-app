"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, ViewTransition } from "react";
import { Menu } from "@/components/ui/menu";
import { firstWeekday, longDay, today } from "@/lib/dates";
import { ASSISTANT_NAME } from "@/lib/product";
import { useStrings } from "@/lib/strings";
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
import { requestGuide, useGuide } from "./guide";
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

const OVERVIEW_BOXES = ["tasks", SPLIT, "calendar", "mail", FOOT, "no_date", "notes", "activity"];

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
  const { t } = useStrings();
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-first-use" data-overview data-first-use>
        <PageHeader title={t("overview.title")} count={mounted ? longDay(today()) : <span className="page-count-wait" aria-hidden="true" />} />
        <Welcome person={person} />
      </div>
    </ViewTransition>
  );
}

function OverviewBoard({ saved, settled: fromServer }: { saved: BoardLayout | null; settled: boolean }) {
  const { t } = useStrings();
  const NAMES: Record<string, string> = { tasks: t("box.tasks"), calendar: t("box.calendar"), mail: t("box.mail"), no_date: t("box.noDate"), activity: t("box.activity"), notes: t("box.notes") };
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
  const search = useSearchParams();
  const account = search.get("account");
  const askedGuide = search.get("guide") === "1";
  useEffect(() => {
    if (!askedGuide) return;
    requestGuide();
    const next = new URLSearchParams(search);
    next.delete("guide");
    const query = next.toString();
    router.replace(query ? `/app?${query}` : "/app");
  }, [askedGuide, router, search]);
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
          purpose: t("box.tasksPurpose"),
          count: tasksCountLabel(tasks.data),
          action: (
            <HeadLink href={tasksHref} name={t("box.openAllTasks")}>
              {t("common.open")}
            </HeadLink>
          ),
          menu: [{ kind: "action", label: t("box.goToTasks"), onSelect: () => router.push(tasksHref) }],
          content: <TasksBoxContent read={tasks} now={now} place={place} placeId={placeId} showPlace layout="list" allHref={tasksHref} />,
        },
        calendar: {
          id: "calendar",
          title: NAMES.calendar,
          purpose: t("box.calendarPurposeOverview"),
          action: (
            <HeadLink href={calendarHref} name={t("box.openCalendar")}>
              {t("common.open")}
            </HeadLink>
          ),
          content: <CalendarBoxContent place={place} now={now} weekStart={weekStart} tasks={allTasks(tasks.data)} calendarHref={calendarHref} />,
        },
        mail: {
          id: "mail",
          title: NAMES.mail,
          purpose: t("box.mailPurposeOverview"),
          count: mailCount,
          action: (
            <HeadLink href="/app/mail" name={t("box.openAllMail")}>
              {t("common.open")}
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
              connectText={connectWords(connectWay, t("connect.itsMail"))}
            />
          ),
        },
        no_date: {
          id: "no_date",
          title: NAMES.no_date,
          purpose: t("box.noDatePurpose"),
          surface: "rest",
          count: noDateCount(tasks.data),
          action: noDateAdd.trigger,
          unfold: noDateAdd.editor,
          content: <NoDateBoxContent read={tasks} showPlace />,
        },
        activity: {
          id: "activity",
          title: NAMES.activity,
          purpose: t("box.activityPurpose", { assistant: ASSISTANT_NAME }),
          surface: "rest",
          content: <ActivityBoxContent place={place} />,
        },
        notes: {
          id: "notes",
          title: place.kind === "node" ? NAMES.notes : t("box.notesGeneral"),
          purpose: t("box.notesPurpose"),
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
      <div className="page page-boxes" data-overview data-today={now ?? undefined} data-deciding={deciding || undefined}>
        <PageHeader
          title={t("overview.title")}
          count={now ? longDay(now) : <span className="page-count-wait" aria-hidden="true" />}
          filters={
            <>
              <TasksPlaceFilter place={place} onChange={(next) => set({ place: placeValue(next), account: null })} tree={tree} now={now} />
              <MailAccountFilter account={account} onChange={(next) => set({ account: next })} mail={mailOfPlace.data} replies={replies.data?.tasks ?? []} />
            </>
          }
          filtersSet={(place.kind === "all" ? 0 : 1) + (account ? 1 : 0)}
          chat
          more={<Menu label={t("common.more")} about={t("board.moreFor", { name: t("overview.title") })} entries={[...customizeEntries(board, NAMES), { kind: "separator" }, { kind: "action", label: t("box.showGuide"), onSelect: guide.start }]} />}
        />
        <ReplyStrip read={replies} now={now} />
        {now ? <BoxBoard board={board} boxes={boxes} label={t("overview.boxesLabel")} hold={deciding} /> : <BoardShell />}
        {guide.layer}
      </div>
    </ViewTransition>
  );
}

export function BoardShell() {
  const { t } = useStrings();
  return (
    <div className="boxes" aria-busy="true">
      <p className="boxes-wait t-meta" role="status">
        {t("overview.reading")}
      </p>
    </div>
  );
}
