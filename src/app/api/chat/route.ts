import { createUIMessageStreamResponse, validateUIMessages, type UIMessage } from "ai";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { chatModel } from "@/lib/chat/model";
import { runChat } from "@/lib/chat/run";
import { secondsToNextDay, takeUsage } from "@/lib/chat/usage";
import { json, problem, sameOrigin, SESSION_HEADERS } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { serviceClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tools/tree";

// Images travel inside the messages, so the body may be large; past this the request is refused before parsing.
const MAX_BODY = 8 * 1024 * 1024;
// The model reads the recent conversation, not the whole history.
const MAX_MESSAGES = 40;

const body = z.object({
  nodeId: z.uuid(),
  timeZone: z.string().min(1).max(64).default("UTC"),
  messages: z.array(z.unknown()).min(1),
});

function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

// The conversation of a node, as it was stored.
export async function GET(request: NextRequest) {
  const nodeId = request.nextUrl.searchParams.get("node") ?? "";
  if (!isUuid(nodeId)) return problem(400, "say which node");
  const session = await sessionContext("chat", nodeId);
  if (!session) return problem(401, "not signed in");
  const { data, error } = await session.ctx.db
    .from("chat_messages")
    .select("id, role, parts")
    .eq("node_id", nodeId)
    .order("created_at")
    .limit(200);
  if (error) {
    console.error("chat history:", error.message);
    return problem(500, "the conversation could not be read");
  }
  return json({ ok: true, messages: data.map((row) => ({ id: row.id, role: row.role, parts: row.parts })) });
}

// One chat turn: the cap is taken first, then the model runs with the tools scoped to the open node, and the
// person's message and the answer are stored when the answer ends.
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

  const session = await sessionContext("chat", parsed.data.nodeId);
  if (!session) return problem(401, "not signed in");
  const { ctx, user } = session;
  const reachable = await ctx.db.from("nodes").select("id").eq("id", parsed.data.nodeId).maybeSingle();
  if (reachable.error || !reachable.data) return problem(404, "no such node");

  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: parsed.data.messages.slice(-MAX_MESSAGES) });
  } catch {
    return problem(422, "the conversation is not in the expected shape");
  }
  const last = messages.at(-1);
  if (!last || last.role !== "user") return problem(422, "the last message must be the person's");

  const taken = await takeUsage(serviceClient(), user.id, "chat_message");
  if (!taken.allowed) {
    if (taken.reason === "error") return problem(503, "the chat is unavailable right now: try again");
    return json(
      { ok: false, code: "cap", message: "You reached today's limit of chat messages. It resets at midnight UTC." },
      429,
      { "Retry-After": String(secondsToNextDay()) },
    );
  }

  const { model, providerOptions } = chatModel();
  const stream = await runChat({
    ctx,
    model,
    providerOptions,
    messages,
    timeZone: validTimeZone(parsed.data.timeZone),
    abortSignal: request.signal,
    onEnd: async ({ responseMessage }) => {
      const rows = [last, responseMessage].map((message) => ({
        node_id: parsed.data.nodeId,
        role: message.role,
        parts: JSON.parse(JSON.stringify(message.parts)),
      }));
      const saved = await ctx.db.from("chat_messages").insert(rows);
      if (saved.error) console.error("chat: storing the turn failed", saved.error.message);
    },
  });
  return createUIMessageStreamResponse({ stream, headers: SESSION_HEADERS });
}
