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
import { countUnreadMail, createTaskFromMail, getMail, linkMail, listMail, searchMail, unlinkMail } from "./mail";
import { getItem, listItemMail } from "./item-detail";
import { listNotes } from "./notes";
import { fail, type ToolError, type ToolResult } from "./result";
import { getTasks, moveItem, reorderItems, requestReview, rescheduleOverdue } from "./tasks";
import { getUpdatesSince } from "./updates";
import { completeTask, dismissReply, listTaskReplies, reopenTask, setTaskMail } from "./waits";


export const tools: Tool[] = [
  listTree,
  getTasks,
  listNotes,
  getItem,
  listItemMail,
  getBoard,
  getOverview,
  browseItems,
  listItems,
  searchItems,
  getUpdatesSince,
  listEvents,
  browseEvents,
  listMail,
  countUnreadMail,
  searchMail,
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
  reopenTask,
];

export function findTool(name: string): Tool | undefined {
  return tools.find((tool) => tool.name === name);
}


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
