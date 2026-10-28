"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore, useCallback, useEffect, useMemo, useState, ViewTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { DEMO_FIRST_STEP } from "@/lib/demo";
import { addDays, addMonths, firstWeekday, instantsOf, isDay, longDay, monthOf, monthTitle, rangeLabel, today, weekOf, type Day } from "@/lib/dates";
import { tool, type CalendarEvent, type EventsFailure, type Item } from "./client-api";
import { PRIORITIES, TYPE_NAMES } from "./item-parts";
import { ItemList, ItemRow } from "./items";
import { Agenda, Empty } from "./node-view";
import { SaveView } from "./saved-views";
import { useWorkspace } from "./workspace";

export type View = "today" | "week" | "month" | "all";
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
];
const TYPES = ["task", "note", "decision", "link", "review"] as const;
const SOURCES = [
  { value: "manual", label: "By hand" },
  { value: "chat", label: "By the chat" },
  { value: "agent", label: "By an agent" },
] as const;
const STATUSES = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "all", label: "Any status" },
] as const;

type Facets = {
  type: Record<string, number>;
  status: Record<string, number>;
  priority: Record<string, number>;
  source: Record<string, number>;
  date: { overdue: number; dated: number; undated: number };
};
type Browse = { items: Item[]; total: number; counts: Facets; scope: { id: string | null; path: string } };
type Events = { events: Array<CalendarEvent & { origin: "google" | "local" }>; failures: EventsFailure[] };

export const PANEL_LAST_KEY = "client-workspace:last-view";

// The panel's state lives in the URL, so reloading and going back bring the same view; the last one is also kept in the
// browser, for the sidebar to offer it again.
export function readPanel(params: URLSearchParams) {
  const view = (VIEWS.some((v) => v.value === params.get("view")) ? params.get("view") : "today") as View;
  const date = isDay(params.get("date")) ? (params.get("date") as Day) : today();
  const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
  const status = (["open", "done", "all"] as const).find((s) => s === params.get("status")) ?? "open";
  return {
    view,
    date,
    scope: params.get("scope") || null,
    type: list("type").filter((t): t is (typeof TYPES)[number] => (TYPES as readonly string[]).includes(t)),
    priority: list("priority").map(Number).filter((p) => p >= 1 && p <= 4),
    source: list("source").filter((s) => SOURCES.some((o) => o.value === s)),
    status,
  };
}

type Panel = ReturnType<typeof readPanel>;

function rangeFor(panel: Panel, weekStart: number): { from: Day; to: Day } | null {
  if (panel.view === "today") return { from: panel.date, to: panel.date };
  if (panel.view === "week") return weekOf(panel.date, weekStart);
  if (panel.view === "month") return monthOf(panel.date);
  return null;
}

export default function PanelPage() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <CentralPanel />
    </Suspense>
  );
}

// The central panel is the house: it opens on Today, and the same list reads a week, a month, or everything, in one
// node and what is below it or in everything, filtered by type, status, priority, and origin, each with its count.
const noSubscription = () => () => {};

function CentralPanel() {
  // The days, the week's first day, and the dates are the browser's: the server's zone and locale never paint them.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const { version, tree, openPalette, isDemo } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const panel = useMemo(() => readPanel(new URLSearchParams(params.toString())), [params]);
  const [weekStart] = useState(() => firstWeekday());
  const [data, setData] = useState<Browse | null>(null);
  const [events, setEvents] = useState<Events | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const now = today();
  const range = rangeFor(panel, weekStart);
  const demoProject = tree?.find((node) => node.path === DEMO_FIRST_STEP);
  const scopeNode = panel.scope ? tree?.find((node) => node.id === panel.scope) : undefined;

  const set = useCallback(
    (change: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(change)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // The last view is kept for the sidebar; the URL stays the source of truth.
  useEffect(() => {
    localStorage.setItem(PANEL_LAST_KEY, params.toString());
  }, [params]);

  // The items and the events of the range are independent: they are read at the same time.
  useEffect(() => {
    let live = true;
    const started = performance.now();
    const filters = {
      ...(panel.scope ? { node: panel.scope } : {}),
      status: panel.status,
      ...(panel.type.length ? { type: panel.type } : {}),
      ...(panel.priority.length ? { priority: panel.priority } : {}),
      ...(panel.source.length ? { source: panel.source } : {}),
      today: now,
      sort: panel.view === "all" ? "priority" : "due",
      limit: 300,
    };
    const dated = panel.view === "today" ? { to: panel.date } : range ? { from: range.from, to: range.to } : {};
    const instants = range ? instantsOf(range.from, range.to) : null;
    void Promise.all([
      tool<Browse>("browse_items", { ...filters, ...dated }),
      instants && range
        ? tool<Events>("browse_events", { ...(panel.scope ? { node: panel.scope } : {}), from: instants.from, to: instants.to, fromDay: range.from, toDay: range.to })
        : Promise.resolve(null),
    ]).then(([items, calendar]) => {
      if (!live) return;
      setTook(Math.round(performance.now() - started));
      if (items.ok) {
        setData(items);
        setError(null);
      } else setError(items.message);
      setEvents(calendar && calendar.ok ? calendar : calendar ? { events: [], failures: [{ accountId: "", accountEmail: "", reason: calendar.message }] } : null);
    });
    return () => {
      live = false;
    };
    // The range is derived from the panel; reading it again on its own would repeat the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, version]);

  const title =
    panel.view === "today"
      ? panel.date === now
        ? "Today"
        : longDay(panel.date)
      : panel.view === "week"
        ? `Week of ${rangeLabel(range!.from, range!.to)}`
        : panel.view === "month"
          ? monthTitle(panel.date)
          : "All";
  const step = (direction: 1 | -1) =>
    set({ date: panel.view === "month" ? addMonths(panel.date, direction) : addDays(panel.date, panel.view === "week" ? 7 * direction : direction) });
  const toggle = (key: "type" | "priority" | "source", value: string) => {
    const current = panel[key].map(String);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    set({ [key]: next.join(",") || null });
  };
  const active = [
    ...panel.type.map((t) => ({ key: "type" as const, value: t, label: TYPE_NAMES[t] })),
    ...panel.priority.map((p) => ({ key: "priority" as const, value: String(p), label: PRIORITIES.find((o) => o.value === String(p))?.label ?? String(p) })),
    ...panel.source.map((s) => ({ key: "source" as const, value: s, label: SOURCES.find((o) => o.value === s)?.label ?? s })),
    ...(panel.status !== "open" ? [{ key: "status" as const, value: panel.status, label: STATUSES.find((o) => o.value === panel.status)!.label }] : []),
  ];
  const clear = () => set({ type: null, priority: null, source: null, status: null });
  const scopeOptions = [{ value: "all", label: "Everything" }, ...(tree ?? []).map((node) => ({ value: node.id, label: node.path }))];

  if (!mounted) return null;
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page" data-panel={panel.view} data-today={panel.view === "today" && data ? panel.date : undefined}>
        <header className="card page-head">
          <p className="t-meta">{panel.view === "today" ? longDay(panel.date) : range ? rangeLabel(range.from, range.to) : "Every item, dated or not"}</p>
          <h1 className="t-h1" tabIndex={-1} data-panel-title>
            {title}
          </h1>
          <div className="panel-bar">
            <Tabs
              label="View"
              value={panel.view}
              onChange={(view) => set({ view: view === "today" ? null : view, date: null })}
              options={VIEWS.map((v) => ({ ...v, controls: "panel-items" }))}
            />
            {panel.view !== "all" && (
              <div className="inline" role="group" aria-label="Move the range">
                <Button size="sm" onClick={() => step(-1)} aria-label={`Previous ${panel.view === "today" ? "day" : panel.view}`}>
                  Previous
                </Button>
                <Button size="sm" onClick={() => set({ date: null })} disabled={panel.date === now} aria-label="Back to today">
                  Today
                </Button>
                <Button size="sm" onClick={() => step(1)} aria-label={`Next ${panel.view === "today" ? "day" : panel.view}`}>
                  Next
                </Button>
              </div>
            )}
            <div className="panel-scope">
              <Select label="Scope" value={panel.scope ?? "all"} options={scopeOptions} onChange={(value) => set({ scope: value === "all" ? null : value })} />
            </div>
          </div>
        </header>

        {isDemo && panel.view === "today" && !panel.scope && (
          <section className="card start-here" data-start-here aria-labelledby="start-here">
            <div className="card-head">
              <h2 id="start-here" className="t-title">
                Start here
              </h2>
              <span className="pill" data-tone="accent">
                Demo
              </span>
            </div>
            <p className="t-help">
              This is your own copy of a small agency&apos;s workspace. Open the project, add a task with the field under
              Tasks, and ask the chat panel to add one for you.
            </p>
            {demoProject ? (
              <div>
                <Link className={buttonClass({ variant: "primary" })} href={`/app/node/${demoProject.id}`} data-first-step-link>
                  <span className="btn-label">Open Northwind Bakery / Website</span>
                </Link>
              </div>
            ) : (
              <p className="t-help">Open a project from the list of projects to start.</p>
            )}
          </section>
        )}

        <section className="card stack" aria-labelledby="filters-title" data-filters>
          <div className="card-head">
            <h2 id="filters-title" className="t-title">
              Filters
            </h2>
            {active.length > 0 && (
              <Button size="sm" variant="quiet" onClick={clear} data-clear-filters>
                Clear
              </Button>
            )}
          </div>
          <FilterGroup label="Type">
            {TYPES.map((type) => (
              <Chip key={type} pressed={panel.type.includes(type)} count={data?.counts.type[type] ?? 0} onClick={() => toggle("type", type)} data={`type:${type}`}>
                {TYPE_NAMES[type]}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            {STATUSES.map((status) => (
              <Chip
                key={status.value}
                pressed={panel.status === status.value}
                count={status.value === "all" ? (data?.counts.status.open ?? 0) + (data?.counts.status.done ?? 0) : (data?.counts.status[status.value] ?? 0)}
                onClick={() => set({ status: status.value === "open" ? null : status.value })}
                data={`status:${status.value}`}
              >
                {status.label}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Priority">
            {PRIORITIES.map((priority) => (
              <Chip key={priority.value} pressed={panel.priority.includes(Number(priority.value))} count={data?.counts.priority[priority.value] ?? 0} onClick={() => toggle("priority", priority.value)} data={`priority:${priority.value}`}>
                {priority.label}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Origin">
            {SOURCES.map((source) => (
              <Chip key={source.value} pressed={panel.source.includes(source.value)} count={data?.counts.source[source.value] ?? 0} onClick={() => toggle("source", source.value)} data={`source:${source.value}`}>
                {source.label}
              </Chip>
            ))}
          </FilterGroup>
          {data && (
            <p className="t-meta" data-date-counts>
              {panel.view === "all"
                ? `${data.counts.date.dated} with a due date · ${data.counts.date.undated} without one (they never fall due)`
                : `${data.counts.date.overdue} late · tasks without a due date are only in All`}
            </p>
          )}
          <SaveView query={params.toString()} />
        </section>

        <section className="card" aria-labelledby="panel-items-title" id="panel-items" data-panel-items>
          <div className="card-head">
            <h2 id="panel-items-title" className="t-title">
              {scopeNode ? scopeNode.path : "Everything"}
            </h2>
            {data && (
              <span className="t-meta" data-panel-total={data.total} data-panel-took={took ?? undefined}>
                {data.total} {data.total === 1 ? "item" : "items"}
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="inline-note" data-tone="alert">
              The items could not be read: {error}.
            </p>
          )}
          {!data ? (
            !error && <ListSkeleton />
          ) : data.items.length === 0 ? (
            <PanelEmpty panel={panel} active={active.map((a) => a.label)} treeEmpty={tree?.length === 0} onClear={clear} onFind={openPalette} onAll={() => set({ view: "all", date: null })} />
          ) : (
            <PanelItems panel={panel} items={data.items} now={now} />
          )}
        </section>

        {events && (
          <section className="card" aria-labelledby="panel-events" data-panel-events>
            <div className="card-head">
              <h2 id="panel-events" className="t-title">
                {panel.view === "today" ? "Events today" : "Events"}
              </h2>
            </div>
            {events.failures.map((failure) => (
              <p key={failure.accountId} role="alert" className="inline-note" data-tone="alert">
                {failure.accountEmail || "The calendars"} could not be read: {failure.reason}
              </p>
            ))}
            {events.events.length === 0 ? (
              <p className="t-help">No events in this range from the accounts and the workspace&apos;s own calendar.</p>
            ) : (
              <Agenda events={events.events} withDay={panel.view !== "today"} />
            )}
          </section>
        )}
      </div>
    </ViewTransition>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="filter-group" role="group" aria-label={label}>
      <span className="t-label filter-label">{label}</span>
      <div className="filter-chips">{children}</div>
    </div>
  );
}

function Chip({ pressed, count, onClick, children, data }: { pressed: boolean; count: number; onClick: () => void; children: string; data: string }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick} data-filter={data}>
      <span className="chip-label">{children}</span>
      <span className="chip-count" aria-label={`${count} ${count === 1 ? "item" : "items"}`}>
        {count}
      </span>
    </button>
  );
}

// The items of the view: Today splits what is late from what is due; a week or a month goes day by day; All is one list.
function PanelItems({ panel, items, now }: { panel: Panel; items: Item[]; now: Day }) {
  if (panel.view === "all") return <ItemList items={items}>{(item) => <ItemRow item={item} showPath />}</ItemList>;
  if (panel.view === "today") {
    const late = items.filter((item) => item.dueOn !== null && item.dueOn < panel.date);
    const due = items.filter((item) => item.dueOn === panel.date);
    return (
      <div className="stack">
        {late.length > 0 && (
          <section className="stack" aria-labelledby="overdue" data-group="late">
            <h3 id="overdue" className="t-label">
              Late
            </h3>
            <ItemList items={late}>{(item) => <ItemRow item={item} showPath />}</ItemList>
          </section>
        )}
        {due.length > 0 && (
          <section className="stack" aria-labelledby="due-today" data-group="due">
            <h3 id="due-today" className="t-label">
              {panel.date === now ? "Due today" : `Due ${longDay(panel.date)}`}
            </h3>
            <ItemList items={due}>{(item) => <ItemRow item={item} showPath />}</ItemList>
          </section>
        )}
      </div>
    );
  }
  const days = [...new Set(items.map((item) => item.dueOn!))].sort();
  return (
    <div className="stack">
      {days.map((day) => (
        <section key={day} className="stack" aria-labelledby={`day-${day}`} data-group={day}>
          <h3 id={`day-${day}`} className="t-label">
            {longDay(day)}
          </h3>
          <ItemList items={items.filter((item) => item.dueOn === day)}>{(item) => <ItemRow item={item} showPath />}</ItemList>
        </section>
      ))}
    </div>
  );
}

// An empty view says why: nothing yet, nothing in this range, or the filters that emptied it, with the action that fixes it.
function PanelEmpty({
  panel,
  active,
  treeEmpty,
  onClear,
  onFind,
  onAll,
}: {
  panel: Panel;
  active: string[];
  treeEmpty: boolean;
  onClear: () => void;
  onFind: () => void;
  onAll: () => void;
}) {
  if (treeEmpty) return <Empty text="Nothing here yet: add your first client in the list of projects." />;
  if (active.length > 0) {
    return (
      <div data-empty-reason="filters">
        <Empty text={`Nothing matches the filters: ${active.join(", ")}.`} action="Clear the filters" onAction={onClear} />
      </div>
    );
  }
  if (panel.view === "today") {
    return (
      <div data-empty-reason="today">
        <Empty text="No tasks are late or due today. Tasks without a due date never fall due: they wait in All." action="Find a project to add a task" onAction={onFind} />
      </div>
    );
  }
  if (panel.view === "all") return <Empty text="No items in this scope yet." action="Find a project to add one" onAction={onFind} />;
  return (
    <div data-empty-reason="range">
      <Empty text={`Nothing falls due in this ${panel.view}. Tasks without a due date are in All.`} action="See All" onAction={onAll} />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="stack" role="status" aria-label="Loading the items" aria-busy="true">
      {["70%", "55%", "62%"].map((width) => (
        <span key={width} className="skeleton" style={{ width }} />
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading the panel" aria-busy="true">
      <div className="card stack">
        <span className="skeleton skeleton-title" style={{ width: "20%" }} />
        <span className="skeleton" style={{ width: "50%" }} />
      </div>
    </div>
  );
}
