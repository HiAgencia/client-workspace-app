import { json } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { listTrash } from "@/lib/tools/items";
import { isError } from "@/lib/tools/result";


export async function GET() {
  const session = await sessionContext("manual");
  if (!session.ok) return session.response;
  const result = await listTrash(session.ctx);
  return isError(result) ? toolResponse("trash", result) : json(result);
}
