"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LOCALE } from "@/lib/dates";
import type { CalendarEvent } from "./client-api";


export function Empty({ text, action, onAction }: { text: ReactNode; action?: string; onAction?: () => void }) {
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

function when(event: CalendarEvent, withDay = true): string {
  if (event.allDay) {
    const day = new Date(`${event.start}T00:00`).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
    return withDay ? `${day} · All day` : "All day";
  }
  const start = new Date(event.start);
  const time = start.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  return withDay ? `${start.toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" })} · ${time}` : time;
}



export function Agenda({ events, withDay = true }: { events: CalendarEvent[]; withDay?: boolean }) {
  return (
    <ul className="agenda">
      {events.map((event) => (
        <li key={`${event.origin ?? "google"}:${event.accountId}:${event.id}`} className="agenda-row">
          <span className="t-meta">{when(event, withDay)}</span>
          <span className="stack" style={{ gap: "0.1rem" }}>
            <span className="t-value">{event.title}</span>
            <span className="t-meta">{event.origin === "local" ? `${WORKSPACE_CALENDAR} · ${event.calendarName}` : `${event.calendarName} · ${event.accountEmail}`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}


export const WORKSPACE_CALENDAR = "Workspace calendar";
