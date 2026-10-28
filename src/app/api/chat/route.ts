import { createUIMessageStreamResponse, validateUIMessages, type UIMessage } from "ai";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { loadHistory, withoutEarlierFiles } from "@/lib/chat/history";
import { chatModel } from "@/lib/chat/model";
import { runChat } from "@/lib/chat/run";
import { capMessage, secondsToNextDay, takeUsageFor } from "@/lib/chat/usage";
import { json, problem, sameOrigin, SESSION_HEADERS } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { serviceClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tools/tree";

// One new message, with at most one attached image; past this the request is refused before parsing.
const MAX_BODY = 6 * 1024 * 1024;
// What the panel shows of a node's conversation.
const SHOWN_MESSAGES = 100;

// Without a node the turn belongs to the workspace's own conversation, over every client and project.
const body = z.object({
  nodeId: z.uuid().nullable().default(null),
  timeZone: z.string().min(1).max(64).default("UTC"),
  message: z.unknown(),
});

function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

// The conversation of a node, or the workspace's own without one, its latest messages in the order they were written.
export async function GET(request: NextRequest) {
  const asked = request.nextUrl.searchParams.get("node");
  if (asked !== null && !isUuid(asked)) return problem(400, "no such node");
  const nodeId = asked;
  const session = await sessionContext("chat", nodeId ?? undefined);
  if (!session) return problem(401, "not signed in");
  try {
    return json({ ok: true, messages: await loadHistory(session.ctx.db, nodeId, SHOWN_MESSAGES) });
  } catch (error) {
    console.error("chat history:", error instanceof Error ? error.message : error);
    return problem(500, "the conversation could not be read");
  }
}

// One chat turn: the browser sends only the new message; the server takes the cap, rebuilds the recent conversation
// from what it stored, runs the model with the tools scoped to the open node (or to everything, without one), and stores
// the turn when it ends whole.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return problem(403, "requests must come from this site");
  const text = await request.text();
  if (text.length > MAX_BODY) return problem(413, "the message is too large: attach a smaller image");
  let parsed;
  try {
    parsed = body.safeParse(JSON.parse(text));
  } catch {
    return problem(400, "the body must be JSON");
  }
  if (!parsed.success) return problem(422, "the message is not in the expected shape");

  const { nodeId } = parsed.data;
  const session = await sessionContext("chat", nodeId ?? undefined);
  if (!session) return problem(401, "not signed in");
  const { ctx, user } = session;
  if (nodeId) {
    const reachable = await ctx.db.from("nodes").select("id").eq("id", nodeId).maybeSingle();
    if (reachable.error || !reachable.data) return problem(404, "no such node");
  }

  let message: UIMessage;
  try {
    [message] = await validateUIMessages({ messages: [parsed.data.message] });
  } catch {
    return problem(422, "the message is not in the expected shape");
  }
  if (message.role !== "user") return problem(422, "only the person's message is sent");
  if (message.parts.filter((part) => part.type === "file").length > 1) return problem(422, "attach one image per message");

  const taken = await takeUsageFor(serviceClient(), user, "chat_message");
  if (!taken.allowed) {
    if (taken.reason === "error") return problem(503, "the chat is unavailable right now: try again");
    return json({ ok: false, code: "cap", message: capMessage(taken.reason, "chat_message") }, 429, {
      "Retry-After": String(secondsToNextDay()),
    });
  }

  let history: UIMessage[];
  try {
    history = await loadHistory(ctx.db, nodeId);
  } catch (error) {
    console.error("chat:", error instanceof Error ? error.message : error);
    return problem(500, "the conversation could not be read");
  }
  const messages = withoutEarlierFiles([...history, message]);

  const { model, providerOptions } = chatModel();
  const stream = await runChat({
    ctx,
    model,
    providerOptions,
    messages,
    timeZone: validTimeZone(parsed.data.timeZone),
    abortSignal: request.signal,
    onEnd: async ({ responseMessage, isAborted }) => {
      // A turn cut short is not stored: its half-made tool calls would be replayed to the model.
      if (isAborted) return;
      const rows = [message, responseMessage].map((entry) => ({
        node_id: nodeId,
        role: entry.role,
        parts: JSON.parse(JSON.stringify(entry.parts)),
      }));
      const saved = await ctx.db.from("chat_messages").insert(rows);
      if (saved.error) console.error("chat: storing the turn failed", saved.error.message);
    },
  });
  return createUIMessageStreamResponse({ stream, headers: SESSION_HEADERS });
}
