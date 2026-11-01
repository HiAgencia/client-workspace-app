import { tool, type ToolSet } from "ai";
import type { ToolContext } from "@/lib/tools/context";
import { callTool, tools } from "@/lib/tools/registry";
import { BROWSER_READS } from "./browser-reads";




export function chatTools(ctx: ToolContext): ToolSet {
  return Object.fromEntries(
    tools.map((definition) => [
      definition.name,
      BROWSER_READS.has(definition.name)
        ? tool({ description: definition.description, inputSchema: definition.input })
        : tool({
            description: definition.description,
            inputSchema: definition.input,
            
            execute: async (input: unknown) => callTool(definition.name, ctx, input),
          }),
    ]),
  );
}
