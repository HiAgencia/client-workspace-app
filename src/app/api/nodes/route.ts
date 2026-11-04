import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { createNode, createNodeInput } from "@/lib/tools/tree-writes";

export async function POST(request: Request) {
  const input = await readInput(request, createNodeInput);
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session.ok) return session.response;
  return toolResponse("create node", await createNode(session.ctx, input.value));
}
