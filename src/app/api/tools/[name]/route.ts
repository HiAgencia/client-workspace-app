import { z } from "zod";
import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { callTool, findScreenTool } from "@/lib/tools/registry";




export async function POST(request: Request, { params }: RouteContext<"/api/tools/[name]">) {
  const { name } = await params;
  if (!findScreenTool(name)) return problem(404, "no such tool");
  const input = await readInput(request, z.unknown());
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse(`tool ${name}`, await callTool(name, session.ctx, input.value));
}
