import { z } from "zod";
import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { callTool, findTool } from "@/lib/tools/registry";
import { isUuid } from "@/lib/tools/tree";




export async function POST(request: Request, { params }: RouteContext<"/api/tools/[name]">) {
  const { name } = await params;
  if (!findTool(name)) return problem(404, "no such tool");
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== null && !isUuid(scope)) return problem(400, "no such node");
  const input = await readInput(request, z.unknown());
  if (!input.ok) return input.response;
  const session = await sessionContext("manual", scope ?? undefined);
  if (!session.ok) return session.response;
  return toolResponse(`tool ${name}`, await callTool(name, session.ctx, input.value));
}
