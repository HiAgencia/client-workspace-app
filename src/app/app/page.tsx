"use client";

import { useEffect, useState, ViewTransition } from "react";
import { longDay } from "@/lib/dates";
import { get, type CalendarEvent, type EventsFailure, type Item } from "./client-api";
import { ItemList, ItemRow } from "./items";
import { Agenda, Empty } from "./node-view";
import { useWorkspace } from "./workspace";

type Today = { day: string; overdue: Item[]; dueToday: Item[]; events: CalendarEvent[]; failures: EventsFailure[] };

// The day in the browser's own time zone: its calendar date and the instants where it starts and ends.
function localDay() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return { day, from: start.toISOString(), to: end.toISOString() };
}

// Today across every project: overdue and due tasks, and today's events from every account.
export default function TodayPage() {
  const { version, tree, openPalette } = useWorkspace();
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { day, from, to } = localDay();
    void get<Today>(`/api/today?${new URLSearchParams({ day, from, to })}`).then((answer) => {
      if (answer.ok) {
        setToday(answer);
        setError(null);
      } else setError(answer.message);
    });
  }, [version]);

  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      <div className="page">
        <header className="card page-head">
          <p className="t-meta">{today ? longDay(today.day) : " "}</p>
          <h1 className="t-h1" tabIndex={-1}>
            Today
          </h1>
          <p className="t-help">What is late or due today in every project, and today&apos;s events from every account.</p>
        </header>
        {!today ? (
          error ? (
            <p role="alert" className="card inline-note" data-tone="alert">
              Today could not be read: {error}. Reload the page to try again.
            </p>
          ) : (
            <div className="card stack" role="status" aria-label="Loading today" aria-busy="true">
              <span className="skeleton skeleton-title" style={{ width: "20%" }} />
              {["70%", "55%", "62%"].map((width) => (
                <span key={width} className="skeleton" style={{ width }} />
              ))}
            </div>
          )
        ) : (
          <div className="page fade-enter" data-today={today.day}>
            {error && (
              <p role="alert" className="inline-note" data-tone="alert">
                Today could not be refreshed: {error}. What you see is the last version read.
              </p>
            )}
            <section className="card" aria-labelledby="due">
              <div className="card-head">
                <h2 id="due" className="t-title">
                  Tasks
                </h2>
                <span className="t-meta">
                  {today.overdue.length} late · {today.dueToday.length} due today
                </span>
              </div>
              {tree?.length === 0 ? (
                <Empty text="Nothing here yet: add your first client in the list of projects." />
              ) : today.overdue.length === 0 && today.dueToday.length === 0 ? (
                <Empty text="No tasks are late or due today." action="Find a task or a project" onAction={openPalette} />
              ) : (
                <div className="stack">
                  {today.overdue.length > 0 && (
                    <div className="stack" aria-labelledby="overdue">
                      <h3 id="overdue" className="t-label">
                        Late
                      </h3>
                      <ItemList items={today.overdue}>{(item) => <ItemRow item={item} showPath />}</ItemList>
                    </div>
                  )}
                  {today.dueToday.length > 0 && (
                    <div className="stack" aria-labelledby="due-today">
                      <h3 id="due-today" className="t-label">
                        Due today
                      </h3>
                      <ItemList items={today.dueToday}>{(item) => <ItemRow item={item} showPath />}</ItemList>
                    </div>
                  )}
                </div>
              )}
            </section>
            <section className="card" aria-labelledby="events">
              <div className="card-head">
                <h2 id="events" className="t-title">
                  Events today
                </h2>
              </div>
              {today.failures.map((failure) => (
                <p key={failure.accountId} role="alert" className="inline-note" data-tone="alert">
                  {failure.accountEmail} could not be read: {failure.reason}
                </p>
              ))}
              {today.events.length === 0 ? (
                <p className="t-help">No events today from your connected accounts.</p>
              ) : (
                <Agenda events={today.events} withDay={false} />
              )}
            </section>
          </div>
        )}
      </div>
    </ViewTransition>
  );
}
