import type { Db } from "@/lib/db/client";
import type { GoogleEvent, GoogleEventInput } from "@/lib/google/api";
import type { TakeResult } from "@/lib/chat/usage";
import type { MailSource } from "@/lib/mail/source";
import type { ReviewJudge } from "@/lib/review/judge";
import type { CalendarEvent, EventsFailure } from "./events-source";

export type ToolSource = "manual" | "chat" | "agent";


export type EventsSource = (args: {
  db: Db;
  ownerId: string;
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
  reviewJudge?: ReviewJudge;
  
  
  reviewQuota?: () => Promise<TakeResult>;
};
