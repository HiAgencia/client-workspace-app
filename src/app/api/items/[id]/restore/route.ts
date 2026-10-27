import { z } from "zod";
import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { restoreItem } from "@/lib/tools/items";
import { isUuid } from "@/lib/tools/tree";

// "Deleted · Undo": brings back an item deleted by hand, by the chat, or by an agent.
export async function POST(request: Request, { params }: RouteContext<"/api/items/[id]/restore">) {
  const { id } = await params;
  if (!isUuid(id)) return problem(404, "no such item");
  const input = await readInput(request, z.unknown());
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse("restore item", await restoreItem(session.ctx, id));
}
