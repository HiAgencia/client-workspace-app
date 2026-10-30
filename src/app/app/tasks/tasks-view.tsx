"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, ViewTransition } from "react";
import { Menu } from "@/components/ui/menu";
import { today } from "@/lib/dates";
import { BoxFailed, BoxWait, savePreference } from "../boxes";
import { placeValue, TaskGroups, useTasksRead, type Sort } from "../box-kinds";
import { PageHeader, type PageLayout } from "../page-header";
import { TasksPlaceFilter, useAddress, usePlaceParam } from "../page-filters";
import { count } from "../count";
import { useChatScope, useWorkspace } from "../workspace";

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "date", label: "By date" },
  { value: "priority", label: "By priority" },
  { value: "manual", label: "Manual" },
];

const noSubscription = () => () => {};

// Every task in the four groups, Upcoming day by day, as a list or as a board. The place, the layout, the order and the
// completed ones live in the address; list or board is also remembered for the person.
export function TasksView({ savedLayout }: { savedLayout: PageLayout | null }) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { tree, notify } = useWorkspace();
  useChatScope(null);
  const params = useSearchParams();
  const { set } = useAddress();
  const place = usePlaceParam(tree);
  const layoutParam = params.get("layout");
  const layout: PageLayout = layoutParam === "board" || layoutParam === "list" ? layoutParam : (savedLayout ?? "list");
  const sortParam = params.get("sort");
  const sort: Sort = sortParam === "priority" || sortParam === "manual" ? sortParam : "date";
  const completed = params.get("completed") === "1";
  const now = mounted ? today() : null;
  const read = useTasksRead(place, now, { sort, withCompleted: completed });
  const { data, error, stale, retry } = read;

  // A link without a layout opens the one the person chose last: the address says it once the page is open.
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
  // What the page lists, and of it what is due: two figures with their own words, so the page's number and the box's
  // —which counts only what has a date— never read as the same thing told twice.
  const open = data ? data.groups.overdue.count + data.groups.today.count + data.groups.upcoming.count + data.groups.noDate.count : null;
  const placeId = place.kind === "node" ? place.id : null;

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page page-tasks" data-tasks-page data-layout={layout}>
        <PageHeader
          title="Tasks"
          count={
            open === null ? (
              <span className="page-count-wait" aria-hidden="true" />
            ) : (
              <>
                {count(open, "open task", "open tasks")}
                {due === 0 ? " · nothing overdue or due today" : ` · ${count(due ?? 0, "task", "tasks")} overdue or due today`}
              </>
            )
          }
          filters={<TasksPlaceFilter place={place} onChange={(next) => set({ place: placeValue(next) })} tree={tree} now={now} />}
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
        <section className="tasks-page card" aria-labelledby="tasks-page-title" aria-busy={!data || stale || undefined}>
          {/* The groups below are h3: the page names what it holds with an h2, so no heading level is skipped. */}
          <h2 id="tasks-page-title" className="sr-only">
            Every task
          </h2>
          {!data ? (
            error ? <BoxFailed what="The tasks" message={error} kept={false} onRetry={retry} /> : <BoxWait what="Reading every task…" rows={5} />
          ) : (
            <div className="box-read fade-enter" data-stale={stale || undefined}>
              {error && <BoxFailed what="The tasks" message={error} kept onRetry={retry} />}
              <TaskGroups view={data} now={now!} mode="page" layout={layout} placeId={placeId} place={place} showPlace sort={sort} />
            </div>
          )}
        </section>
      </div>
    </ViewTransition>
  );
}
