import { json, problem } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { listRevisions } from "@/lib/tools/items";
import { isError } from "@/lib/tools/result";
import { isUuid } from "@/lib/tools/tree";

// The versions an item left, newest first, with who made each change.
export async function GET(_request: Request, { params }: RouteContext<"/api/items/[id]/revisions">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such item");
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const result = await listRevisions(session.ctx, id);
  return isError(result) ? toolResponse("item revisions", result) : json(result);
}
