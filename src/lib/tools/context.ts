import type { Db } from "@/lib/db/client";
import type { CalendarEvent, EventsFailure } from "./events-source";

export type ToolSource = "manual" | "chat" | "agent";


export type EventsSource = (args: {
  db: Db;
  ownerId: string;
  nodeId: string;
  from: string;
  to: string;
}) => Promise<{ events: CalendarEvent[]; failures: EventsFailure[] }>;




export type ToolContext = {
  db: Db;
  ownerId: string;
  scopeNodeId?: string;
  source: ToolSource;
  agentLabel?: string;
  
  updatesSince?: string;
  events?: EventsSource;
};
