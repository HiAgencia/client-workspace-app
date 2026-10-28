import { json, problem } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { EVENT_COLUMNS, taskEventLinks, toLocalEvent } from "@/lib/tools/local-events";
import { isError } from "@/lib/tools/result";
import { isUuid, loadScope } from "@/lib/tools/tree";

// The event a task lives in, seen from the task: the workspace's own event with its title and day, or a Google one.
export async function GET(_request: Request, { params }: RouteContext<"/api/items/[id]/event">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such item");
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const links = await taskEventLinks(session.ctx, { itemIds: [id] });
  if (isError(links)) return toolResponse("task event", links);
  const link = links.links[0];
  if (!link) return json({ ok: true, link: null, event: null });
  if (!link.eventId) return json({ ok: true, link, event: null });
  const loaded = await loadScope(session.ctx);
  if (isError(loaded)) return toolResponse("task event", loaded);
  const { data, error } = await session.ctx.db.from("events").select(EVENT_COLUMNS).eq("id", link.eventId).maybeSingle();
  if (error) return problem(500, "the event could not be read");
  return json({ ok: true, link, event: data && loaded.scope.reachable.has(data.node_id) ? toLocalEvent(data, loaded.scope) : null });
}
