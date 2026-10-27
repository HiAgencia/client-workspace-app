import { tool, type ToolSet } from "ai";
import type { ToolContext } from "@/lib/tools/context";
import { callTool, tools } from "@/lib/tools/registry";

// The registry published for the AI SDK: the same tools the screens and the MCP server use, run in the chat's
// context (the signed-in person's client, scoped to the open node, writing with source "chat").
export function chatTools(ctx: ToolContext): ToolSet {
  return Object.fromEntries(
    tools.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.input,
        // Failures come back as data the model reads, never as an exception that ends the turn.
        execute: async (input: unknown) => callTool(definition.name, ctx, input),
      }),
    ]),
  );
}
