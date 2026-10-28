"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useSyncExternalStore, ViewTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { firstWeekday, longDay, today, weekOf } from "@/lib/dates";
import { Empty } from "./blocks";
import { ChatToggle } from "./chat-panel";
import { type Board } from "./client-api";
import { GoogleOutcome } from "./node-view";
import { SavedViews } from "./saved-views";
import {
  ActivitySection,
  AgendaSection,
  ClientsAndProjects,
  eventsToday,
  Figures,
  NodeCards,
  placesIn,
  ReviewSection,
  TasksSection,
  useAgenda,
  useBoardState,
  useRead,
  type FigureKey,
} from "./sections";
import { useChatScope, useWorkspace } from "./workspace";

export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <Overview />
    </Suspense>
  );
}

const noSubscription = () => () => {};

// The Overview: the house, where everything is managed at a glance. A general filter on top —which client or project—
// reaches every section; below it, the figures that take the view to what they count, the tasks and the agenda side by
// side, the clients and projects with what is pending in each, what waits for review, and what changed. Each section
// carries its own filters, and the chat opens beside it on demand, over every client and project.
function Overview() {
  // The days, the week's first day, and the dates are the browser's: the server's zone and locale never paint them.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { tree } = useWorkspace();
  useChatScope(null);
  const { state, set, query } = useBoardState();
  const google = useSearchParams().get("google");
  const [weekStart] = useState(() => firstWeekday());
  const now = today();
  const week = weekOf(now, weekStart);
  // The week's figure counts the same days the Tasks section's week lists, its first days included.
  const board = useRead<Board>("get_board", { ...(state.scope ? { node: state.scope } : {}), today: now, from: week.from, through: week.to });
  const figures = board.stale ? null : board.data;
  const agenda = useAgenda(state.scope, state.agenda, now, weekStart);
  const scopeNode = tree?.find((node) => node.id === state.scope);

  // A figure filters its section and takes the view there, with the focus on the section's title.
  function pick(target: FigureKey) {
    const section = target === "review" ? "review" : target === "events" ? "agenda" : "tasks";
    if (target === "late" || target === "today") set({ tasks: null, status: null });
    if (target === "week") set({ tasks: "week", status: null });
    if (target === "review") set({ review: null });
    if (target === "events") set({ agenda: "today" });
    requestAnimationFrame(() => {
      const title = document.getElementById(`${section}-title`);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      title?.closest("section")?.scrollIntoView({ block: "start", behavior: reduced ? "instant" : "smooth" });
      title?.focus({ preventScroll: true });
    });
  }

  const scopeOptions = [{ value: "all", label: "All clients and projects" }, ...(tree ?? []).map((node) => ({ value: node.id, label: node.path }))];
  const scopeChildren = scopeNode ? (tree ?? []).filter((node) => node.parentId === scopeNode.id) : [];

  if (!mounted) return null;
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page board" data-overview data-today={figures ? now : undefined}>
        <header className="card page-head">
          <div className="page-head-row page-head-split">
            <div className="stack page-head-text">
              <p className="t-meta">{longDay(now)}</p>
              <h1 className="t-h1" tabIndex={-1} data-page-title>
                Overview
              </h1>
            </div>
            <div className="page-actions">
              <ChatToggle />
              <Link className={buttonClass({ size: "sm" })} href="/app/settings#agent-tokens">
                <span className="btn-label">Issue an agent token</span>
              </Link>
            </div>
          </div>
          <div className="board-bar" role="group" aria-label="What the Overview shows">
            <div className="board-scope">
              <Select label="Client or project" value={state.scope ?? "all"} options={scopeOptions} onChange={(value) => set({ scope: value === "all" ? null : value })} />
            </div>
            <SavedViews query={query} />
          </div>
          {google && <GoogleOutcome outcome={google} />}
        </header>

        <Figures board={figures} failed={board.error} week={week} events={eventsToday(agenda, now)} onPick={pick} />

        <div className="board-row board-row-wide">
          <TasksSection scope={state.scope} state={state} set={set} now={now} weekStart={weekStart} places={placesIn(tree, state.scope)} />
          <AgendaSection agenda={agenda} state={state} set={set} now={now} weekStart={weekStart} calendarHref={state.scope ? `/app/calendar?scope=${state.scope}` : "/app/calendar"} />
        </div>

        {scopeNode ? (
          <section className="card board-section" aria-labelledby="nodes-title" id="clients-and-projects" data-section="nodes">
            <div className="section-head">
              <div className="section-title">
                <h2 id="nodes-title" className="t-title" tabIndex={-1}>
                  {scopeNode.kind === "client" ? `Projects of ${scopeNode.name}` : `Subprojects of ${scopeNode.name}`}
                </h2>
                <span className="t-meta">{scopeChildren.length}</span>
              </div>
            </div>
            <NodeCards nodes={scopeChildren} tree={tree ?? []} board={figures} failed={board.error !== null} empty={<Empty text={`No ${scopeNode.kind === "client" ? "projects" : "subprojects"} in ${scopeNode.name} yet.`} />} />
          </section>
        ) : (
          <ClientsAndProjects tree={tree} board={figures} failed={board.error !== null} state={state} set={set} />
        )}

        <div className="board-row board-row-split">
          <ReviewSection scope={state.scope} state={state} set={set} />
          <ActivitySection scope={state.scope} state={state} set={set} />
        </div>
      </div>
    </ViewTransition>
  );
}

function OverviewSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading the Overview" aria-busy="true">
      <div className="card stack">
        <span className="skeleton" style={{ width: "14%" }} />
        <span className="skeleton skeleton-title" style={{ width: "24%" }} />
        <span className="skeleton" style={{ width: "50%" }} />
      </div>
    </div>
  );
}
