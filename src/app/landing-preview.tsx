"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { addDays, LOCALE, today, type Day } from "@/lib/dates";
import type { DemoOverview } from "@/lib/demo-seed";
import { PathText } from "./app/item-parts";
import "./styles/boxes.css";
import "./styles/task.css";

// The landing's picture of the demo, drawn with the workspace's own pieces and sheets —a box with its title and count, the
// task's row with its circle, its data and its place, the week, the mail's rows, the notice of the daily review—. It is a
// picture, not controls: inert and out of the accessibility tree, its caption says what it shows. It does not import the
// workspace's components, so the landing does not load them. Its figures are the planted demo's own, counted from the
// seed (`demoOverview`); its rows, its event and its messages are a few of the demo's, drawn on a working morning at the
// moment the daily review completes a task, so the hours of the mail and the completed row still in the list are that
// moment's. The week is the visitor's own, read once mounted; the server paints the same week without its numbers.

type Row = {
  title: string;
  priority: number;
  when?: { label: string; tone: "overdue" | "today" | "tomorrow" | "week" };
  place: { path: string; color: string | null };
  data?: string[];
  mail?: "waiting" | "arrived";
  by?: string;
  done?: boolean;
};

const OVERDUE: Row[] = [{ title: "Send the October invoices", priority: 1, when: { label: "Yesterday", tone: "overdue" }, place: { path: "Operations", color: null }, data: ["Urgent"] }];

const TODAY: Row[] = [
  { title: "Send the homepage draft for review", priority: 1, when: { label: "4:00 PM", tone: "today" }, place: { path: "Larkspur Bakery / Website", color: "amber" }, data: ["1/3", "Urgent"] },
  { title: "Wait for the bank transfer", priority: 2, place: { path: "Operations", color: null }, mail: "waiting" },
  { title: "Wait for the app review approval", priority: 2, place: { path: "Operations", color: null }, mail: "arrived", by: "By the daily review", done: true },
];

const noSubscription = () => () => {};

// Where a task lives, with its place's color, as the workspace's row says it.
function PlaceName({ path, color }: { path: string; color: string | null }) {
  return (
    <span className="task-place-name" data-color={color ?? undefined}>
      <PathText path={path} />
    </span>
  );
}

function PreviewRow({ row }: { row: Row }) {
  return (
    <li className="task-item">
      <div className="task" data-layout="list" data-place="" data-done={row.done || undefined}>
        <span className="task-circle task-check" role="checkbox" aria-checked={Boolean(row.done)} data-priority={row.priority} />
        <p className="task-title t-value">{row.title}</p>
        <p className="task-place t-meta">
          <PlaceName path={row.place.path} color={row.place.color} />
        </p>
        <div className="task-meta t-meta">
          {row.when && (
            <span className="task-when" data-when={row.when.tone}>
              <span className="picker">{row.when.label}</span>
            </span>
          )}
          {row.data?.map((datum) =>
            datum === "Urgent" ? (
              <span key={datum} className="task-priority" data-priority={row.priority}>
                {datum}
              </span>
            ) : (
              <span key={datum} className="task-subtasks-toggle">
                {datum}
              </span>
            ),
          )}
          {row.mail && (
            <span className="task-mail" data-mail={row.mail}>
              {row.mail === "arrived" ? "Mail arrived" : "Waiting for mail"}
            </span>
          )}
          {row.by && <span className="task-source">{row.by}</span>}
        </div>
      </div>
    </li>
  );
}

function Group({ title, tone, rows, count }: { title: string; tone: "overdue" | "today"; rows: Row[]; count: number }) {
  return (
    <section className="group">
      <div className="group-head">
        <p className="group-title" data-when={tone}>
          {title}
        </p>
        <span className="group-count">{count}</span>
      </div>
      <ul className="task-list" data-layout="list" data-place="">
        {rows.map((row) => (
          <PreviewRow key={row.title} row={row} />
        ))}
      </ul>
    </section>
  );
}

// Monday to Sunday around the visitor's day.
function weekOf(day: Day): Day[] {
  const [y, m, d] = day.split("-").map(Number);
  const offset = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => addDays(day, index - offset));
}

export function LandingPreview({ figures }: { figures: DemoOverview }) {
  const now = useSyncExternalStore(noSubscription, () => today(), () => null);
  const week = now ? weekOf(now) : null;
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const longDay = now ? new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${now}T12:00:00`)) : null;

  return (
    <figure className="landing-preview enter" aria-labelledby="preview-caption" data-landing-preview>
      <div className="preview-frame" inert aria-hidden="true">
        <div className="preview-head">
          <p className="t-title preview-title">Overview</p>
          <p className="page-count preview-day">{longDay ?? " "}</p>
        </div>
        <div className="preview-boxes">
          <section className="box preview-box" data-preview-box="tasks" data-shown="" style={{ "--enter-delay": "140ms" } as CSSProperties}>
            <header className="box-head">
              <p className="t-title box-title">Tasks</p>
              <span className="box-count">{figures.scheduled} scheduled</span>
            </header>
            <div className="box-body">
              <div className="groups">
                <Group title="Overdue" tone="overdue" rows={OVERDUE} count={figures.overdue} />
                <Group title="Today" tone="today" rows={TODAY} count={figures.today} />
              </div>
            </div>
          </section>
          <div className="preview-side">
            <section className="box preview-box" data-preview-box="calendar" data-shown="" style={{ "--enter-delay": "200ms" } as CSSProperties}>
              <header className="box-head">
                <p className="t-title box-title">Calendar</p>
              </header>
              <div className="box-body">
                <div className="week">
                  {names.map((name, index) => {
                    const day = week?.[index];
                    const current = day !== undefined && day === now;
                    return (
                      <span key={name} className="week-day" aria-current={current ? "date" : undefined} aria-pressed={current ? "true" : undefined}>
                        <span className="week-name">{name}</span>
                        <span className="week-number" data-known={day ? "" : undefined}>
                          {day ? Number(day.slice(8)) : " "}
                        </span>
                        <span className="week-mark" data-some={index < 5 || undefined} aria-hidden="true" />
                      </span>
                    );
                  })}
                </div>
                <div className="day-events">
                  <p className="group-title" data-when="today">
                    Today
                  </p>
                  <ul className="event-list">
                    <li className="event-row">
                      <span className="event-when">All day</span>
                      <span className="event-what">
                        <span className="event-title">Weekly planning</span>
                        <span className="event-where">Operations</span>
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
            <section className="box preview-box" data-preview-box="mail" data-shown="" style={{ "--enter-delay": "260ms" } as CSSProperties}>
              <header className="box-head">
                <p className="t-title box-title">Mail</p>
                <span className="box-count">{figures.unread} unread</span>
              </header>
              <div className="box-body">
                <ul className="mail-list">
                  <li>
                    <span className="mail-row" data-unread="">
                      <span className="mail-from">Developer Platform</span>
                      <span className="mail-side">
                        <span className="mail-when">9:05 AM</span>
                      </span>
                      <span className="mail-subject">Your app review was approved</span>
                      <span className="mail-for">For: Wait for the app review approval</span>
                    </span>
                  </li>
                  <li>
                    <span className="mail-row" data-unread="">
                      <span className="mail-from">Maya Chen</span>
                      <span className="mail-side">
                        <span className="pill mail-important">Important</span>
                        <span className="mail-when">10:42 AM</span>
                      </span>
                      <span className="mail-subject">New photos for the homepage</span>
                      <span className="mail-for">
                        <PlaceName path="Larkspur Bakery / Website" color="amber" />
                      </span>
                    </span>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </div>
        <div className="notice preview-notice" data-tone="status">
          <span className="t-value notice-text">The daily review completed “Wait for the app review approval”: Developer Platform wrote “Your app review was approved”.</span>
          <span className="btn btn-primary btn-sm preview-undo">
            <span className="btn-label">Undo</span>
          </span>
        </div>
      </div>
      <figcaption id="preview-caption" className="t-meta">
        The demo&apos;s Overview: the day&apos;s tasks with their places, the week, the mail a task waits for, and a task the daily review completed when its message arrived.
      </figcaption>
    </figure>
  );
}
