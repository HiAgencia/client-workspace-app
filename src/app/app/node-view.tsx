"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { get, tool, type CalendarEvent, type EventsFailure, type Item } from "./client-api";
import { ConnectBlockedNote, type ConnectBlocked } from "./connect-blocked";
import { ItemRow, QuickAdd } from "./items";
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

function when(event: CalendarEvent): string {
  if (event.allDay) return `${new Date(`${event.start}T00:00`).toLocaleDateString()} · all day`;
  const start = new Date(event.start);
  return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

// A node: its path, its own and inherited accounts, tasks by priority with quick add, decisions, links, things to
// review, and the agenda of its calendars. Everything is read and written through the tool layer.
export function NodeView({ nodeId, googleOutcome }: { nodeId: string; googleOutcome: string | null }) {
  const { version, tree } = useWorkspace();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [done, setDone] = useState<Item[]>([]);
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
      if (accountsAnswer.ok) setAccounts({ list: accountsAnswer.accounts, canConnect: accountsAnswer.canConnect, connectBlocked: accountsAnswer.connectBlocked });
    });
    return () => {
      live = false;
    };
  }, [nodeId, version]);

  if (notFound) return <p>This project does not exist or is not yours. Pick one from the list.</p>;
  if (!overview) return <p aria-busy="true">{error ? `The project could not be read: ${error}` : "Loading the project…"}</p>;

  // Inheritance: an account hanging from this node or any ancestor is visible here, and says where it comes from.
  const ancestors: string[] = [];
  for (let cursor = tree?.find((n) => n.id === nodeId); cursor; cursor = tree?.find((n) => n.id === cursor!.parentId)) {
    ancestors.push(cursor.id);
  }
  const visible = (accounts?.list ?? [])
    .map((account) => ({ account, from: ancestors.find((id) => account.nodeIds.includes(id)) }))
    .filter((entry) => entry.from);

  return (
    <article className="flex flex-col gap-8" data-node-view={nodeId}>
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{overview.node.path}</h1>
        <div className="flex flex-wrap gap-3">
          <Link href={`/app/node/${nodeId}/agent`}>Connect your agent</Link>
        </div>
        {googleOutcome && <GoogleOutcome outcome={googleOutcome} />}
        {error && <p role="alert">The project could not be refreshed: {error}</p>}
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="tasks">
        <h2 id="tasks" className="font-semibold">Tasks</h2>
        <QuickAdd nodeId={nodeId} type="task" />
        {overview.openTasks.length === 0 ? (
          <p>No open tasks here. Add one above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {overview.openTasks.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details>
            <summary>Done ({done.length})</summary>
            <ul className="flex flex-col gap-2">
              {done.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          </details>
        )}
      </section>

      <Section title="Decisions" type="decision" nodeId={nodeId} items={overview.decisions} empty="No decisions recorded here yet." />
      <Section title="Links" type="link" nodeId={nodeId} items={overview.links} empty="No links saved here yet." />
      <Section title="To review" type="review" nodeId={nodeId} items={overview.toReview} empty="Nothing to review here." />

      <section className="flex flex-col gap-3" aria-labelledby="accounts">
        <h2 id="accounts" className="font-semibold">Google accounts</h2>
        {accounts === null ? (
          <p aria-busy="true">Loading accounts…</p>
        ) : visible.length === 0 ? (
          <p>No Google account is visible here.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {visible.map(({ account, from }) => (
              <li key={account.id} data-account={account.email} data-inherited={from !== nodeId}>
                {account.email} —{" "}
                {from === nodeId ? "own" : `inherited from ${tree?.find((n) => n.id === from)?.path ?? "a parent"}`}
                {account.status !== "active" && ` (${account.status}: connect it again)`}
              </li>
            ))}
          </ul>
        )}
        {accounts?.canConnect ? (
          <a href={`/api/google/connect?node=${nodeId}`}>Connect a Google account here</a>
        ) : (
          <ConnectBlockedNote reason={accounts?.connectBlocked ?? null} />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="agenda">
        <h2 id="agenda" className="font-semibold">Agenda, next seven days</h2>
        {overview.eventFailures.map((failure) => (
          <p key={failure.accountId} role="alert">
            {failure.accountEmail} could not be read: {failure.reason}
          </p>
        ))}
        {overview.events.length === 0 ? (
          <p>No events in the next seven days from the accounts visible here.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {overview.events.map((event) => (
              <li key={`${event.accountId}:${event.id}`} data-event>
                {when(event)} — {event.title} ({event.accountEmail})
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

function Section({ title, type, nodeId, items, empty }: { title: string; type: Item["type"]; nodeId: string; items: Item[]; empty: string }) {
  const id = `section-${type}`;
  return (
    <section className="flex flex-col gap-3" aria-labelledby={id}>
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <QuickAdd nodeId={nodeId} type={type} />
      {items.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
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
  return <p role={outcome === "connected" ? "status" : "alert"}>{text}</p>;
}
