import {
  convertToModelMessages,
  isStepCount,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { count } from "@/lib/count";
import type { ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";
import { stepsTaken, whatWasDone } from "./browser-reads";
import { stepCost, UNREPORTED_STEP } from "./credits";
import { chatTools } from "./tools";

const MAX_STEPS = 6;

type TreeRow = { id: string; path: string; openTasks: number };

export async function systemPrompt(ctx: ToolContext, timeZone: string, now = new Date()): Promise<string> {
  const tree = (await callTool("list_tree", ctx, {})) as { ok: boolean; nodes?: TreeRow[] };
  const nodes = tree.ok && tree.nodes ? tree.nodes : [];
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  const summary = nodes
    .slice(0, 80)
    .map((node) => `- ${node.path} (${count(node.openTasks, "open task", "open tasks")})`)
    .join("\n");
  return [
    "You work inside a task manager where every task has an optional place —a client, a project, a subproject, or",
    "none, which is General— and an optional due day, sometimes with an hour; notes hang from a place, from a task, or",
    "from nothing, and a decision is a note marked as one. Clients and the person's own projects stand at the root. You",
    "act on it with your tools: create, move, reschedule, and complete tasks, write notes and decisions, look up what is",
    "overdue, due today, upcoming, and what changed, read the calendars, and advise on what to do next from what you",
    "read. A link goes over its words: [words](https://address). Act when asked to act; do not ask for confirmation of a",
    "write, since every write can be undone from the screen.",
    "The person may undo any write from the screen without telling you, so this conversation is not the current state:",
    "before saying an item is already done, closed, or changed, read it again, and act on what you read.",
    "When you tell what arrived for the tasks that wait for mail, write one line per task, its title in quotes followed",
    "by a colon and what arrived: “Title”: 2 possible replies, the latest …; or “Title”: nothing has arrived yet.",
    "When you tell what is on a calendar, name every event you read for the period asked, each by its title and time; a",
    "calendar asked about with no period covers the seven days from today, today included, every one of its events named.",
    "A request to create something creates it even when a similar item exists; you may mention the similar one after.",
    "Mail and calendars are read one account per call: what a read did not read is listed in its toRead (eventsToRead in get_overview, mailToRead in get_item), and each account listed is read with its own call. get_overview and get_item read no connected account here.",
    ctx.scopeNodeId
      ? "Prefer the open node when the person does not name another."
      : "No node is open: this conversation covers every client and project, and General. Write where the request says; a task that names no client or project and fits none goes to General.",
    "A screenshot or image the person sends may hold requests from a client: turn each request into a task.",
    "You also guide the person through the app when they ask how to do something in it: the sidebar opens Overview,",
    "Tasks, Calendar, Mail, Guide, Help, Trash and Settings, and lists the clients and projects with «Add client» and «Add",
    "project»; «Add task» and the Q key add a task, with its date, place, priority and event chosen in its fields, and the",
    "task opens when added; Ctrl+K (Cmd+K on a Mac) finds a client, a project, a task or an action; a client's or a",
    "project's More connects a Google account, whose calendar and mail are then seen there and in what hangs from it, and",
    "issues an agent token, which Settings lists with the .mcp.json block for a coding agent; Settings also holds the",
    "theme and the connected accounts; Guide walks through the Overview. Name the control by the words it shows.",
    "Your scope is this workspace and this app: its tasks, notes, decisions, calendars and mail, and how to use it. A",
    "request outside it —writing code, an essay, general knowledge, another product— is declined in one sentence that says",
    "what you can do here instead; it is not answered, not even in part.",
    "Answer briefly, in the person's language. Never invent items, dates, or links you did not read.",
    "",
    `Now: ${local} (time zone ${timeZone}).`,
    ctx.scopeNodeId ? `Open node: ${nodes.find((n) => n.id === ctx.scopeNodeId)?.path ?? "the current node"}.` : "",
    "Nodes in reach:",
    summary || "- (none yet)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function describeModelError(error: unknown): string {
  const status = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 0;
  console.error("chat model:", status || "", error instanceof Error ? error.message : error);
  if (status === 429) return "It is busy right now. Try again in a minute.";
  if (status === 401 || status === 403) return "It is unavailable right now.";
  return "Try again in a moment.";
}

export async function runChat(options: {
  ctx: ToolContext;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  messages: UIMessage[];
  timeZone: string;
  onEnd?: (event: { responseMessage: UIMessage; isAborted: boolean }) => Promise<void> | void;
  abortSignal?: AbortSignal;
  onCost?: (microUsd: number) => void;
}): Promise<ReadableStream<UIMessageChunk>> {
  const taken = stepsTaken(options.messages);
  const result = streamText({
    model: options.model,
    system: await systemPrompt(options.ctx, options.timeZone),
    messages: await convertToModelMessages(options.messages.map(whatWasDone)),
    tools: chatTools(options.ctx),
    stopWhen: isStepCount(Math.max(1, MAX_STEPS - taken)),
    prepareStep: ({ stepNumber }) => (taken + stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" as const } : undefined),
    providerOptions: options.providerOptions,
    abortSignal: options.abortSignal,
    onStepEnd: ({ usage }) => options.onCost?.(stepCost(usage)),
    onAbort: () => options.onCost?.(UNREPORTED_STEP),
  });
  return toUIMessageStream({
    stream: result.stream,
    originalMessages: options.messages,
    sendReasoning: true,
    onError: describeModelError,
    onEnd: options.onEnd,
  });
}
