"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, ViewTransition } from "react";
import { Menu } from "@/components/ui/menu";
import { count } from "@/lib/count";
import { today } from "@/lib/dates";
import { BoxFailed, GroupsWait, savePreference } from "../boxes";
import { placeValue, TaskGroups, useTasksRead, type Sort } from "../box-kinds";
import { PageHeader, type PageLayout } from "../page-header";
import { TasksPlaceFilter, useAddress, usePlaceParam } from "../page-filters";
import { useSwap } from "../use-swap";
import { useChatScope, useWorkspace } from "../workspace";

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "date", label: "By date" },
  { value: "priority", label: "By priority" },
  { value: "manual", label: "Manual" },
];

const noSubscription = () => () => {};

export function TasksView({ savedLayout }: { savedLayout: PageLayout | null }) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { tree, notify } = useWorkspace();
  useChatScope(null);
  const params = useSearchParams();
  const { set } = useAddress();
  const place = usePlaceParam(tree);
  const layoutParam = params.get("layout");
  const layout: PageLayout = layoutParam === "board" || layoutParam === "list" ? layoutParam : (savedLayout ?? "list");
  const swap = useSwap(layout, layout);
  const sortParam = params.get("sort");
  const sort: Sort = sortParam === "priority" || sortParam === "manual" ? sortParam : "date";
  const completed = params.get("completed") === "1";
  const now = mounted ? today() : null;
  const read = useTasksRead(place, now, { sort, withCompleted: completed });
  const { data, error, stale, retry } = read;

  useEffect(() => {
    if (!layoutParam && savedLayout) set({ layout: savedLayout });
  }, [layoutParam, savedLayout, set]);

  function chooseLayout(value: PageLayout) {
    set({ layout: value });
    void savePreference({ page: "tasks", layout: value }).then((answer) => {
      if (!answer.ok) notify({ text: `The layout could not be remembered: ${answer.message}`, tone: "error" });
    });
  }

  const due = data ? data.groups.overdue.count + data.groups.today.count : null;
  const open = data ? data.groups.overdue.count + data.groups.today.count + data.groups.upcoming.count + data.groups.noDate.count : null;
  const placeId = place.kind === "node" ? place.id : null;

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-tasks" data-tasks-page data-layout={swap.shown}>
        <PageHeader
          title="Tasks"
          count={
            open === null ? (
              <span className="page-count-wait" aria-hidden="true" />
            ) : (
              <>
                {count(open, "open task", "open tasks")}.{" "}
                {due === 0 ? "Nothing is overdue or due today." : `${due === 1 ? "1 is" : `${due} are`} overdue or due today.`}
              </>
            )
          }
          filters={<TasksPlaceFilter place={place} onChange={(next) => set({ place: placeValue(next) })} tree={tree} now={now} />}
          filtersSet={place.kind === "all" ? 0 : 1}
          layout={{ value: layout, onChange: chooseLayout }}
          chat
          more={
            <Menu
              label="More"
              about="for Tasks"
              entries={[
                { kind: "action", label: completed ? "Hide completed" : "Show completed", onSelect: () => set({ completed: completed ? null : "1" }) },
                { kind: "choice", label: "Sort", value: sort, options: SORTS, onChoose: (value) => set({ sort: value === "date" ? null : value }) },
              ]}
            />
          }
        />
        <section className="tasks-page" aria-labelledby="tasks-page-title" aria-busy={!data || stale || undefined}>
          <h2 id="tasks-page-title" className="sr-only">
            Every task
          </h2>
          {!data ? (
            error ? (
              <div className="card">
                <BoxFailed what="The tasks" message={error} kept={false} onRetry={retry} />
              </div>
            ) : (
              <GroupsWait what="Loading every task…" layout={layout} />
            )
          ) : (
            <div className="box-read fade-enter" data-stale={stale || undefined} data-leaving={swap.leaving || undefined}>
              {error && <BoxFailed what="The tasks" message={error} kept onRetry={retry} />}
              <TaskGroups view={data} now={now!} mode="page" layout={swap.shown} placeId={placeId} place={place} showPlace sort={sort} />
            </div>
          )}
        </section>
      </div>
    </ViewTransition>
  );
}
