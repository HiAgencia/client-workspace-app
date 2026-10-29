import { z } from "zod";
import { problem } from "@/lib/http";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { callTool, findScreenTool } from "@/lib/tools/registry";

// The screens' door to the shared tool layer: what a person does by hand runs through the same tools as the chat and
// the agent, recorded with source "manual". The tool validates its own input. A tool that is the chat's own (the daily
// review asked for on purpose) is not dispatched here.
export async function POST(request: Request, { params }: RouteContext<"/api/tools/[name]">) {
  const { name } = await params;
  if (!findScreenTool(name)) return problem(404, "no such tool");
  const input = await readInput(request, z.unknown());
  if (!input.ok) return input.response;
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse(`tool ${name}`, await callTool(name, session.ctx, input.value));
}
