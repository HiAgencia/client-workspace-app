import { tool, type ToolSet } from "ai";
import type { ToolContext } from "@/lib/tools/context";
import { callTool, tools } from "@/lib/tools/registry";



export function chatTools(ctx: ToolContext): ToolSet {
  return Object.fromEntries(
    tools.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.input,
        
        execute: async (input: unknown) => callTool(definition.name, ctx, input),
      }),
    ]),
  );
}
