import type { z } from "zod";
import type { ToolContext } from "./context";
import type { ToolResult } from "./result";



export type Tool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  readOnly: boolean;
  
  personOnly?: boolean;
  input: I;
  output: O;
  run(ctx: ToolContext, input: z.output<I>): Promise<ToolResult<z.output<O>>>;
};

export function defineTool<I extends z.ZodType, O extends z.ZodType>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}
