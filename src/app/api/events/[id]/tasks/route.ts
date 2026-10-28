import { json, problem } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { taskEventLinks } from "@/lib/tools/local-events";
import { isError } from "@/lib/tools/result";
import { selectAllItems, toItem } from "@/lib/tools/rows";
import { loadScope, isUuid } from "@/lib/tools/tree";

// The tasks that live inside an event of the workspace's own.
export async function GET(_request: Request, { params }: RouteContext<"/api/events/[id]/tasks">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such event");
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const links = await taskEventLinks(session.ctx, { eventIds: [id] });
  if (isError(links)) return toolResponse("event tasks", links);
  const loaded = await loadScope(session.ctx);
  if (isError(loaded)) return toolResponse("event tasks", loaded);
  const ids = links.links.map((link) => link.itemId);
  if (ids.length === 0) return json({ ok: true, items: [] });
  const read = await selectAllItems(session.ctx, [...loaded.scope.reachable], (query) => query.in("id", ids).is("deleted_at", null), "reading the event's tasks");
  if (isError(read)) return toolResponse("event tasks", read);
  return json({ ok: true, items: read.rows.map((row) => toItem(row, loaded.scope)) });
}
