import type { Db } from "@/lib/db/client";
import type { GoogleEvent, GoogleEventInput } from "@/lib/google/api";
import type { MailSource } from "@/lib/mail/source";
import type { CalendarEvent, EventsFailure } from "./events-source";

export type ToolSource = "manual" | "chat" | "agent";

type EventsAccount = { id: string; email: string; isDemo: boolean; status: string };

export type EventsSource = (args: {
  db: Db;
  ownerId: string;
  account: EventsAccount;
  nodeId: string;
  from: string;
  to: string;
}) => Promise<{ events: CalendarEvent[]; failures: EventsFailure[] }>;

export type CalendarWriter = {
  create(args: { ownerId: string; accountId: string; calendarId: string; event: GoogleEventInput }): Promise<GoogleEvent>;
  update(args: { ownerId: string; accountId: string; calendarId: string; eventId: string; event: GoogleEventInput }): Promise<GoogleEvent>;
  remove(args: { ownerId: string; accountId: string; calendarId: string; eventId: string }): Promise<void>;
};

export type ToolContext = {
  db: Db;
  ownerId: string;
  scopeNodeId?: string;
  source: ToolSource;
  agentLabel?: string;
  updatesSince?: string;
  events?: EventsSource;
  calendar?: CalendarWriter;
  mail?: MailSource;
};
