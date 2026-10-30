import { z } from "zod";
import type { ToolContext } from "./context";
import type { Tool } from "./define";
import { getBoard } from "./board";
import { browseEvents, browseItems } from "./browse";
import { listEvents } from "./events";
import { addDecision, addNote, createTask, deleteItem, listItems, searchItems, updateItem } from "./items";
import { createEvent, deleteEvent, linkNodeEvent, linkTaskEvent, unlinkNodeEvent, unlinkTaskEvent, updateEvent } from "./local-events";
import { createGoogleEvent, deleteGoogleEvent, updateGoogleEvent } from "./google-events";
import { getOverview, listTree } from "./nodes";
import { createTaskFromMail, getMail, linkMail, listMail, unlinkMail } from "./mail";
import { getItem } from "./item-detail";
import { listNotes } from "./notes";
import { fail, type ToolError, type ToolResult } from "./result";
import { getTasks, moveItem, reorderItems, requestReview, rescheduleOverdue } from "./tasks";
import { getUpdatesSince } from "./updates";
import { completeTask, dismissReply, listTaskReplies, setTaskMail } from "./waits";

// The single list the chat, a coding agent's MCP and the screens' tool route publish, in the order a model reads them.
export const tools: Tool[] = [
  listTree,
  getTasks,
  listNotes,
  getItem,
  getBoard,
  getOverview,
  browseItems,
  listItems,
  searchItems,
  getUpdatesSince,
  listEvents,
  browseEvents,
  listMail,
  getMail,
  createTask,
  addNote,
  addDecision,
  updateItem,
  moveItem,
  reorderItems,
  rescheduleOverdue,
  requestReview,
  deleteItem,
  createEvent,
  updateEvent,
  deleteEvent,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  linkTaskEvent,
  unlinkTaskEvent,
  linkNodeEvent,
  unlinkNodeEvent,
  linkMail,
  unlinkMail,
  createTaskFromMail,
  setTaskMail,
  listTaskReplies,
  dismissReply,
  completeTask,
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
