import { json, problem } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { listTrash } from "@/lib/tools/items";
import { isError } from "@/lib/tools/result";

// What was deleted, each branch once by its top item, newest first; restoring goes through /api/items/<id>/restore.
export async function GET() {
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const result = await listTrash(session.ctx);
  return isError(result) ? toolResponse("trash", result) : json(result);
}
