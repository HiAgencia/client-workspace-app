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
import type { ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";
import { chatTools } from "./tools";

// A turn may call several tools in a row (look up, then write, then answer); the loop ends at this bound.
const MAX_STEPS = 6;

type TreeRow = { id: string; path: string; openTasks: number; openReviews: number };

// What the model knows before reading anything: when and where the person is, the open node, and the tree around it.
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
    .map((node) => `- ${node.path} (${node.openTasks} open tasks, ${node.openReviews} to review)`)
    .join("\n");
  return [
    "You work inside a task manager where each client, project, and subproject keeps its tasks, decisions, links,",
    "and items to review; clients and the person's own projects stand at the root. You act on it with your tools:",
    "create tasks, record decisions, save links and items to review, update and complete items, look up what is",
    "pending and what changed, read the calendars, and advise on what to do next from what you read. Act when asked",
    "to act; do not ask for confirmation of a write, since every write can be undone from the screen.",
    ctx.scopeNodeId
      ? "Prefer the open node when the person does not name another."
      : "No node is open: this conversation covers every client and project. Write where the request says; when it names no client or project and none fits, ask where it goes.",
    "A screenshot or image the person sends may hold requests from a client: turn each request into a task.",
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

// The model's failure reaches the panel as one readable sentence; its detail goes to the server log.
export function describeModelError(error: unknown): string {
  const status = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 0;
  console.error("chat model:", status || "", error instanceof Error ? error.message : error);
  if (status === 429) return "The model is busy right now. Try again in a minute.";
  if (status === 401 || status === 403) return "The model rejected this server's key. The chat is unavailable.";
  return "The model did not answer. Try again.";
}

export async function runChat(options: {
  ctx: ToolContext;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  messages: UIMessage[];
  timeZone: string;
  onEnd?: (event: { responseMessage: UIMessage; isAborted: boolean }) => Promise<void> | void;
  abortSignal?: AbortSignal;
}): Promise<ReadableStream<UIMessageChunk>> {
  const result = streamText({
    model: options.model,
    system: await systemPrompt(options.ctx, options.timeZone),
    // A tool call left without its result (a turn cut short) is not replayed to the provider, which would refuse it.
    messages: await convertToModelMessages(options.messages, { ignoreIncompleteToolCalls: true }),
    tools: chatTools(options.ctx),
    stopWhen: isStepCount(MAX_STEPS),
    providerOptions: options.providerOptions,
    abortSignal: options.abortSignal,
  });
  return toUIMessageStream({
    stream: result.stream,
    originalMessages: options.messages,
    sendReasoning: true,
    onError: describeModelError,
    onEnd: options.onEnd,
  });
}
