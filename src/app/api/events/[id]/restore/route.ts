import { z } from "zod";
import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { restoreEvent } from "@/lib/tools/local-events";
import { isUuid } from "@/lib/tools/tree";

// "Deleted · Undo" for an event of the workspace's own.
export async function POST(request: Request, { params }: RouteContext<"/api/events/[id]/restore">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such event");
  const input = await readInput(request, z.unknown());
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse("restore event", await restoreEvent(session.ctx, id));
}
