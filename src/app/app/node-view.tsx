"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { DEMO_FIRST_STEP } from "@/lib/demo";
import { LOCALE } from "@/lib/dates";
import { get, tool, type CalendarEvent, type EventsFailure, type Item, type TreeNode } from "./client-api";
import { ConnectBlockedNote, type ConnectBlocked } from "./connect-blocked";
import { land, onFocusRequest, takeFocusRequest, type FocusRequest, type FocusTarget, type Landing } from "./focus-request";
import { ItemList, ItemRow, QuickAdd } from "./items";
import { useWorkspace } from "./workspace";

type Overview = {
  node: { id: string; path: string; kind: string };
  children: Array<{ id: string; name: string }>;
  openTasks: Item[];
  decisions: Item[];
  links: Item[];
  toReview: Item[];
  events: CalendarEvent[];
  eventFailures: EventsFailure[];
};

type Account = { id: string; email: string; status: string; nodeIds: string[] };

const KIND: Record<string, string> = { client: "Client", project: "Project", subproject: "Subproject" };

export function when(event: CalendarEvent, withDay = true): string {
  if (event.allDay) {
    const day = new Date(`${event.start}T00:00`).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
    return withDay ? `${day} · All day` : "All day";
  }
  const start = new Date(event.start);
  const time = start.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  return withDay ? `${start.toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" })} · ${time}` : time;
}

function ancestorsOf(tree: TreeNode[] | null, nodeId: string): TreeNode[] {
  const chain: TreeNode[] = [];
  for (let cursor = tree?.find((n) => n.id === nodeId); cursor; cursor = tree?.find((n) => n.id === cursor!.parentId)) chain.unshift(cursor);
  return chain;
}

// A node: its path, its own and inherited accounts, tasks by priority with quick add, decisions, links, things to
// review, and the agenda of its calendars. Everything is read and written through the tool layer; a re-read repaints
// in place and keeps what the person had open.
export function NodeView({ nodeId, googleOutcome, onReveal }: { nodeId: string; googleOutcome: string | null; onReveal?: () => void }) {
  const { version, tree, notify, isDemo } = useWorkspace();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [done, setDone] = useState<Item[]>([]);
  const [showDone, setShowDone] = useState(false);
  // Once the done tasks' fold finished opening, what overflows it (a focus ring) shows; while it travels it clips.
  const [doneSettled, setDoneSettled] = useState(false);
  // A landing on a done task waits for that fold: the first scroll is measured against a list still clipped, so it is
  // repeated once the fold finished opening.
  const pendingDone = useRef<FocusRequest | null>(null);
  const [accounts, setAccounts] = useState<{ list: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      tool<Overview>("get_overview", { node: nodeId }),
      tool<{ items: Item[] }>("list_items", { node: nodeId, type: "task", status: "done" }),
      get<{ accounts: Account[]; canConnect: boolean; connectBlocked: ConnectBlocked }>("/api/accounts"),
    ]).then(([answer, finished, accountsAnswer]) => {
      // An answer for a node the person already left does not paint here.
      if (!live) return;
      if (answer.ok) {
        setOverview(answer);
        setError(null);
      } else if (answer.code === "not_found") setNotFound(true);
      else setError(answer.message);
      if (finished.ok) setDone(finished.items);
      else notify({ text: "The done tasks could not be read.", tone: "error" });
      if (accountsAnswer.ok) setAccounts({ list: accountsAnswer.accounts, canConnect: accountsAnswer.canConnect, connectBlocked: accountsAnswer.connectBlocked });
    });
    return () => {
      live = false;
    };
  }, [nodeId, version, notify]);

  // The palette, the tree, or a row's path may have asked to land somewhere in this node: once its data is on screen,
  // what hides the place opens —the project's tab where the window holds one pane, the done tasks' fold— and after it
  // painted the view goes there with the focus set. A place that is not on the page says so.
  const ready = overview !== null;
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const request = takeFocusRequest(nodeId);
      if (!request) return;
      const { target } = request;
      onReveal?.();
      if (target.kind === "item" && done.some((item) => item.id === target.itemId)) {
        setShowDone(true);
        // With motion the fold travels: the landing is repeated from its transition end, or the focused row can end
        // below the viewport. The reduced-motion rule shortens that transition to an instant, and the event still
        // fires, so the second landing also runs there.
        if (!doneSettled) pendingDone.current = request;
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const landing = land(target, { acted: request.acted });
          if (landing === "missing" || landing === "hidden") notify({ text: notLanded(target, landing), tone: "status" });
        }),
      );
    };
    apply();
    return onFocusRequest(apply);
  }, [ready, nodeId, done, onReveal, notify, doneSettled]);

  if (notFound) {
    return (
      <section className="card stack" aria-labelledby="missing">
        <h1 id="missing" className="t-h1">
          This project is not here
        </h1>
        <p className="t-help">It was deleted, or it belongs to another account. Pick one from the list of projects, or start from today.</p>
        <div>
          <Link className={buttonClass({ variant: "primary" })} href="/app">
            <span className="btn-label">Go to Today</span>
          </Link>
        </div>
      </section>
    );
  }
  if (!overview) return <NodeSkeleton failed={error} />;

  const chain = ancestorsOf(tree, nodeId);
  const name = chain.at(-1)?.name ?? overview.node.path.split(" / ").at(-1) ?? overview.node.path;
  const ancestors = chain.slice(0, -1);
  const visible = (accounts?.list ?? [])
    .map((account) => ({ account, from: chain.map((n) => n.id).reverse().find((id) => account.nodeIds.includes(id)) }))
    .filter((entry) => entry.from);
  const openReviews = overview.toReview.length;

  return (
    <article className="page fade-enter" data-node-view={nodeId}>
      <header className="card page-head">
        {ancestors.length > 0 && (
          <nav aria-label="Path">
            <ol className="crumbs t-meta">
              {ancestors.map((node) => (
                <li key={node.id}>
                  <Link className="link" href={`/app/node/${node.id}`}>
                    {node.name}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="t-h1" tabIndex={-1} data-node-title>
          {name}
        </h1>
        <div className="facts t-meta">
          <span className="nowrap">{KIND[overview.node.kind] ?? overview.node.kind}</span>
          <span className="nowrap">{plural(overview.openTasks.length, "open task", "open tasks")}</span>
          <span className="nowrap">{plural(openReviews, "thing to review", "things to review")}</span>
          {overview.children.length > 0 && (
            <span>
              {overview.children.length === 1 ? "Subproject" : "Subprojects"}:{" "}
              {overview.children.map((child, index) => (
                <span key={child.id}>
                  {index > 0 && ", "}
                  <Link className="link" href={`/app/node/${child.id}`}>
                    {child.name}
                  </Link>
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="inline">
          <Link className={buttonClass({ size: "sm" })} href={`/app/node/${nodeId}/agent`}>
            <span className="btn-label">Connect your agent</span>
          </Link>
        </div>
        {isDemo && overview.node.path === DEMO_FIRST_STEP && (
          <p className="inline-note" data-tone="accent" data-first-step-note>
            Add a task with the field under Tasks, or ask the chat panel to add one. This is the project the demo starts
            on.
          </p>
        )}
        {googleOutcome && <GoogleOutcome outcome={googleOutcome} />}
        {error && (
          <p role="alert" className="inline-note" data-tone="alert">
            The project could not be refreshed: {error}. What you see is the last version read.
          </p>
        )}
      </header>

      <section className="card" aria-labelledby="tasks">
        <div className="card-head">
          <h2 id="tasks" className="t-title">
            Tasks
          </h2>
          <span className="t-meta">{plural(overview.openTasks.length, "open", "open")}</span>
        </div>
        <QuickAdd nodeId={nodeId} type="task" />
        {overview.openTasks.length === 0 ? (
          <Empty text="No open tasks here." action="Add a task" onAction={() => focusQuickAdd(nodeId, "task")} />
        ) : (
          <ItemList items={overview.openTasks}>{(item) => <ItemRow item={item} />}</ItemList>
        )}
        {done.length > 0 && (
          <div className="done-toggle">
            <Button
              variant="quiet"
              size="sm"
              aria-expanded={showDone}
              aria-controls="done-tasks"
              onClick={() => {
                setDoneSettled(false);
                // A landing waiting for the fold is dropped when the fold is closed by hand.
                pendingDone.current = null;
                setShowDone((v) => !v);
              }}
            >
              Done ({done.length})
            </Button>
            <div
              className="fold"
              id="done-tasks"
              data-open={showDone}
              data-settled={(showDone && doneSettled) || undefined}
              onTransitionEnd={(event) => {
                if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows") return;
                setDoneSettled(showDone);
                // The fold reached its open height: the landing on a done task is repeated now that the row's place is
                // final.
                if (showDone && pendingDone.current) {
                  const request = pendingDone.current;
                  pendingDone.current = null;
                  land(request.target, { acted: request.acted });
                }
              }}
              onTransitionCancel={(event) => {
                if (event.target !== event.currentTarget) return;
                pendingDone.current = null;
                setDoneSettled(false);
              }}
            >
              <div>
                <ItemList items={done}>{(item) => <ItemRow item={item} />}</ItemList>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="cards-2">
        <div className="cards-2-inner">
          <Section title="Decisions" type="decision" nodeId={nodeId} items={overview.decisions} empty="No decisions recorded here yet." action="Record a decision" />
          <Section title="To review" type="review" nodeId={nodeId} items={overview.toReview} empty="Nothing to review here." action="Add something to review" />
          <Section title="Links" type="link" nodeId={nodeId} items={overview.links} empty="No links saved here yet." action="Save a link" />
          <section className="card" aria-labelledby="accounts">
            <div className="card-head">
              <h2 id="accounts" className="t-title">
                Google accounts
              </h2>
            </div>
            {accounts === null ? (
              <div className="stack" role="status" aria-label="Loading accounts" aria-busy="true">
                <span className="skeleton" style={{ width: "70%" }} />
                <span className="skeleton" style={{ width: "45%" }} />
              </div>
            ) : (
              <div className="stack">
                {visible.length === 0 ? (
                  <p className="t-help">No Google account is visible here: one connected here or above shows its calendars in this project.</p>
                ) : (
                  <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {visible.map(({ account, from }) => (
                      <li key={account.id} className="account-line">
                        <span className="t-name">{account.email}</span>
                        <span className="pill" data-tone={from === nodeId ? "accent" : undefined}>
                          {from === nodeId ? "Own" : `Inherited from ${tree?.find((n) => n.id === from)?.name ?? "a parent"}`}
                        </span>
                        {account.status !== "active" && (
                          <span className="pill" data-tone="alert">
                            {account.status === "revoked" ? "Access revoked: connect it again" : account.status}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {accounts.canConnect ? (
                  <div>
                    <a className={buttonClass({ size: "sm" })} href={`/api/google/connect?node=${nodeId}`}>
                      <span className="btn-label">Connect a Google account here</span>
                    </a>
                  </div>
                ) : (
                  <ConnectBlockedNote reason={accounts.connectBlocked} />
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="agenda">
        <div className="card-head">
          <h2 id="agenda" className="t-title">
            Agenda
          </h2>
          <span className="t-meta">Next seven days</span>
        </div>
        {overview.eventFailures.map((failure) => (
          <p key={failure.accountId} role="alert" className="inline-note" data-tone="alert">
            {failure.accountEmail} could not be read: {failure.reason}
          </p>
        ))}
        {overview.events.length === 0 ? (
          <p className="t-help">No events in the next seven days from the accounts visible here.</p>
        ) : (
          <Agenda events={overview.events} />
        )}
      </section>
    </article>
  );
}

export function Agenda({ events, withDay = true }: { events: CalendarEvent[]; withDay?: boolean }) {
  return (
    <ul className="agenda">
      {events.map((event) => (
        <li key={`${event.accountId}:${event.id}`} className="agenda-row">
          <span className="t-meta">{when(event, withDay)}</span>
          <span className="stack" style={{ gap: "0.1rem" }}>
            <span className="t-value">{event.title}</span>
            <span className="t-meta">
              {event.calendarName} · {event.accountEmail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, type, nodeId, items, empty, action }: { title: string; type: Item["type"]; nodeId: string; items: Item[]; empty: string; action: string }) {
  const id = `section-${type}`;
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id} className="t-title">
          {title}
        </h2>
        {items.length > 0 && <span className="t-meta">{items.length}</span>}
      </div>
      <QuickAdd nodeId={nodeId} type={type} />
      {items.length === 0 ? (
        <Empty text={empty} action={action} onAction={() => focusQuickAdd(nodeId, type)} />
      ) : (
        <ItemList items={items}>{(item) => <ItemRow item={item} />}</ItemList>
      )}
    </section>
  );
}

// An empty state says what is missing and carries its own button, which takes the focus to where it is filled.
export function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty">
      <p className="t-help">{text}</p>
      {action && onAction && (
        <Button size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

function focusQuickAdd(nodeId: string, type: Item["type"]) {
  land({ kind: "quick-add", nodeId, type });
}

function notLanded(target: FocusTarget, landing: Landing): string {
  if (landing === "hidden") return "That place is there, but something on top of it holds the focus: close it and try again.";
  if (target.kind !== "item") return "That place is not on this page.";
  if (target.type === "decision" || target.type === "link") return `“${target.title}” is not on this page: it lists the latest ${target.type}s.`;
  return `“${target.title}” is not on this page anymore.`;
}

function plural(count: number, one: string, many: string): string {
  return new Intl.PluralRules("en").select(count) === "one" ? `${count} ${one}` : `${count} ${many}`;
}

function NodeSkeleton({ failed }: { failed: string | null }) {
  if (failed) {
    return (
      <section className="card stack" role="alert">
        <h1 className="t-title">The project could not be read</h1>
        <p className="t-help">{failed}. Reload the page to try again.</p>
      </section>
    );
  }
  return (
    <div className="page" role="status" aria-label="Loading the project" aria-busy="true">
      <div className="card stack">
        <span className="skeleton" style={{ width: "18%" }} />
        <span className="skeleton skeleton-title" style={{ width: "42%", height: "1.9rem" }} />
        <span className="skeleton" style={{ width: "30%" }} />
      </div>
      <div className="card stack">
        <span className="skeleton skeleton-title" style={{ width: "16%" }} />
        <span className="skeleton" style={{ width: "100%", height: "2.5rem" }} />
        {["72%", "58%", "64%"].map((width) => (
          <span key={width} className="skeleton" style={{ width }} />
        ))}
      </div>
    </div>
  );
}

const outcomes: Record<string, string> = {
  connected: "The Google account is connected here.",
  cancelled: "Connecting the Google account was cancelled.",
  failed: "The Google account could not be connected. Try again.",
  "invalid-state": "That connection link expired or was started elsewhere. Start again from here.",
  "not-configured": "Connecting Google accounts is not configured on this server.",
};

function GoogleOutcome({ outcome }: { outcome: string }) {
  const text = outcomes[outcome];
  if (!text) return null;
  return (
    <p role={outcome === "connected" ? "status" : "alert"} className="inline-note" data-tone={outcome === "connected" ? "accent" : "alert"}>
      {text}
    </p>
  );
}
