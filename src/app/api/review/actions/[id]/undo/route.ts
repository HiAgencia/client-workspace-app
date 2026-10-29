import { z } from "zod";
import { problem } from "@/lib/http";
import { undoReviewAction } from "@/lib/review/run";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { isUuid } from "@/lib/tools/tree";

// "Undo" for one thing the daily review did: what was there before comes back. Undoing twice changes nothing.
export async function POST(request: Request, { params }: RouteContext<"/api/review/actions/[id]/undo">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such action");
  const input = await readInput(request, z.unknown());
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse("undo review action", await undoReviewAction(session.ctx, id));
}
