"use client";

import { useEffect, useState } from "react";
import { get, type CalendarEvent, type EventsFailure, type Item } from "./client-api";
import { ItemRow } from "./items";
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
  const { version, tree } = useWorkspace();
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

  if (!today) return <p aria-busy="true">{error ? `Today could not be read: ${error}` : "Loading today…"}</p>;
  const nothing = today.overdue.length === 0 && today.dueToday.length === 0;

  return (
    <article className="flex flex-col gap-8" data-today={today.day}>
      <h1 className="text-xl font-semibold">Today</h1>
      {error && <p role="alert">Today could not be refreshed: {error}</p>}
      {tree?.length === 0 ? (
        <p>Nothing here yet: add your first client in the list of projects.</p>
      ) : nothing ? (
        <p>No tasks due today or overdue.</p>
      ) : (
        <>
          {today.overdue.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="overdue">
              <h2 id="overdue" className="font-semibold">Overdue</h2>
              <ul className="flex flex-col gap-2">
                {today.overdue.map((item) => (
                  <ItemRow key={item.id} item={item} showPath />
                ))}
              </ul>
            </section>
          )}
          {today.dueToday.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="due">
              <h2 id="due" className="font-semibold">Due today</h2>
              <ul className="flex flex-col gap-2">
                {today.dueToday.map((item) => (
                  <ItemRow key={item.id} item={item} showPath />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="events">
        <h2 id="events" className="font-semibold">Events today</h2>
        {today.failures.map((failure) => (
          <p key={failure.accountId} role="alert">
            {failure.accountEmail} could not be read: {failure.reason}
          </p>
        ))}
        {today.events.length === 0 ? (
          <p>No events today from your connected accounts.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {today.events.map((event) => (
              <li key={`${event.accountId}:${event.id}`} data-event>
                {event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} —{" "}
                {event.title} ({event.accountEmail})
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
