import { z } from "zod";
import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { restoreRevision } from "@/lib/tools/items";
import { isUuid } from "@/lib/tools/tree";

// Writes a version back over its item; the change leaves its own version, so a restore is undone the same way.
export async function POST(request: Request, { params }: RouteContext<"/api/revisions/[id]/restore">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such version");
  const input = await readInput(request, z.unknown());
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse("restore revision", await restoreRevision(session.ctx, id));
}
