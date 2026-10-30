import { googleDeps } from "@/lib/google/deps";
import { googleCalendarWriter, googleEventsSource } from "@/lib/google/events";
import { gmailMailSource } from "@/lib/google/gmail";
import { demoMailSource } from "@/lib/mail/source";
import { takeUsageFor } from "@/lib/chat/usage";
import { currentUser, serviceClient, userClient, type SessionUser } from "@/lib/supabase/server";
import type { ToolContext, ToolSource } from "@/lib/tools/context";




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
      mail: deps ? gmailMailSource(deps) : demoMailSource(),
      reviewQuota: () => takeUsageFor(serviceClient(), user, "daily_review"),
    },
  };
}
