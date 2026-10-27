import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { isUuid } from "@/lib/tools/tree";
import { changeNode, changeNodeInput } from "@/lib/tools/tree-writes";

// Renaming or archiving a node, and restoring an archived one.
export async function PATCH(request: Request, { params }: RouteContext<"/api/nodes/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such node");
  const input = await readInput(request, changeNodeInput);
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse("change node", await changeNode(session.ctx, id, input.value));
}
