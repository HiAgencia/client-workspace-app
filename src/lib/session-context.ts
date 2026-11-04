import { googleDeps } from "@/lib/google/deps";
import { demoEventsSource, googleCalendarWriter, googleEventsSource } from "@/lib/google/events";
import { gmailMailSource } from "@/lib/google/gmail";
import { demoMailSource } from "@/lib/mail/source";
import { requireUser, userClient, type SessionUser } from "@/lib/supabase/server";
import type { ToolContext, ToolSource } from "@/lib/tools/context";

export async function sessionContext(
  source: ToolSource,
  scopeNodeId?: string,
): Promise<{ ok: true; ctx: ToolContext; user: SessionUser } | { ok: false; response: Response }> {
  const db = await userClient();
  const who = await requireUser(db);
  if (!who.ok) return who;
  const deps = await googleDeps();
  return {
    ok: true,
    user: who.user,
    ctx: {
      db,
      ownerId: who.user.id,
      source,
      scopeNodeId,
      events: who.user.isAnonymous ? demoEventsSource() : deps ? googleEventsSource(deps) : undefined,
      calendar: deps ? googleCalendarWriter(deps) : undefined,
      mail: deps ? gmailMailSource(deps) : demoMailSource(),
    },
  };
}
