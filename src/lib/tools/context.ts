import type { Db } from "@/lib/db/client";
import type { CalendarEvent, EventsFailure } from "./events-source";

export type ToolSource = "manual" | "chat" | "agent";

// Where the events of a node's accounts come from; injected so the tools are tested without Google.
export type EventsSource = (args: {
  db: Db;
  ownerId: string;
  nodeId: string;
  from: string;
  to: string;
}) => Promise<{ events: CalendarEvent[]; failures: EventsFailure[] }>;

// Who is acting, what they can reach, and where the write comes from. `db` is the signed-in user's client
// (row-level security) for the screens and the chat, and the service client for the MCP server; the tools also
// filter by `ownerId` and by `scopeNodeId`'s subtree in code, so the service client reaches no further.
export type ToolContext = {
  db: Db;
  ownerId: string;
  scopeNodeId?: string;
  source: ToolSource;
  agentLabel?: string;
  // Where "what's new" starts when the caller gives no moment: an MCP token's last use.
  updatesSince?: string;
  events?: EventsSource;
};
