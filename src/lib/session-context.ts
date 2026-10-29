import { googleDeps } from "@/lib/google/deps";
import { googleCalendarWriter, googleEventsSource } from "@/lib/google/events";
import { demoMailSource } from "@/lib/mail/source";
import { takeUsageFor } from "@/lib/chat/usage";
import { currentUser, serviceClient, userClient, type SessionUser } from "@/lib/supabase/server";
import type { ToolContext, ToolSource } from "@/lib/tools/context";

// The tool context of the signed-in person: their own client under row-level security, the whole tree in reach, and
// their Google events when connecting accounts is configured. A daily review read by Meta's model takes a unit of their
// day, the same caps as the chat's.
export async function sessionContext(
  source: ToolSource,
  scopeNodeId?: string,
): Promise<{ ctx: ToolContext; user: SessionUser } | null> {
  const db = await userClient();
  const user = await currentUser(db);
  if (!user) return null;
  const deps = await googleDeps();
  return {
    user,
    ctx: {
      db,
      ownerId: user.id,
      source,
      scopeNodeId,
      events: deps ? googleEventsSource(deps) : undefined,
      calendar: deps ? googleCalendarWriter(deps) : undefined,
      mail: demoMailSource(),
      reviewQuota: () => takeUsageFor(serviceClient(), user, "daily_review"),
    },
  };
}
