import type { z } from "zod";
import type { ToolContext } from "./context";
import type { ToolResult } from "./result";

// One tool: what a model reads to choose it, the shape it accepts, the shape it returns on success, and its body.
// `run` receives input already validated against `input`; failures come back as `{ ok: false, code, message }`.
export type Tool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  readOnly: boolean;
  // Only the chat publishes it: neither a coding agent's MCP nor the screens' tool route dispatches it.
  chatOnly?: boolean;
  input: I;
  output: O;
  run(ctx: ToolContext, input: z.output<I>): Promise<ToolResult<z.output<O>>>;
};

export function defineTool<I extends z.ZodType, O extends z.ZodType>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}
