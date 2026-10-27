import { z } from "zod";
import type { ToolContext } from "./context";
import type { Tool } from "./define";
import { listEvents } from "./events";
import { addDecision, addLink, addReview, createTask, deleteItem, listItems, searchItems, updateItem } from "./items";
import { getOverview, listTree } from "./nodes";
import { fail, type ToolError, type ToolResult } from "./result";
import { getUpdatesSince } from "./updates";

// The single list the chat and the MCP server publish, in the order a model reads them.
export const tools: Tool[] = [
  listTree,
  getOverview,
  listItems,
  searchItems,
  getUpdatesSince,
  listEvents,
  createTask,
  updateItem,
  addDecision,
  addLink,
  addReview,
  deleteItem,
];

export function findTool(name: string): Tool | undefined {
  return tools.find((tool) => tool.name === name);
}

// Validates the input and runs the tool; whatever goes wrong comes back as data, never as an exception.
export async function callTool(name: string, ctx: ToolContext, input: unknown): Promise<ToolResult<unknown> | ToolError> {
  const tool = findTool(name);
  if (!tool) return fail("not_found", `there is no tool named ${name}`);
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) return fail("invalid_input", z.prettifyError(parsed.error));
  try {
    return await tool.run(ctx, parsed.data);
  } catch (error) {
    return fail("internal", error instanceof Error ? error.message : "the tool failed");
  }
}
