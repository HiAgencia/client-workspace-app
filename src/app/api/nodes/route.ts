import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { createNode, createNodeInput } from "@/lib/tools/tree-writes";

// Creating a node in place in the tree: a client or a project of one's own at the root, a project under a client, a
// subproject below a project.
export async function POST(request: Request) {
  const input = await readInput(request, createNodeInput);
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse("create node", await createNode(session.ctx, input.value));
}
