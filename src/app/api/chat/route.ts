import { createUIMessageStreamResponse, isToolUIPart, validateUIMessages, type UIMessage } from "ai";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { continuedTurn, openCall, whatWasDone } from "@/lib/chat/browser-reads";
import { loadHistory, NEW_CHAT_MARK, withoutEarlierFiles } from "@/lib/chat/history";
import { addServerSpend, chooseKey, CREDITS_MESSAGE } from "@/lib/chat/credits";
import { AI_OFF_MESSAGE, chatModel, chatProvider } from "@/lib/chat/model";
import { runChat } from "@/lib/chat/run";
import { capMessage, secondsToNextDay, takeUsageFor } from "@/lib/chat/usage";
import { json, problem, sameOrigin, SESSION_HEADERS } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { serviceClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tools/tree";

const MAX_BODY = 6 * 1024 * 1024;
const SHOWN_MESSAGES = 100;
const NOTHING_WAITING = "this turn has no read waiting for that answer: send the message again";

const body = z.object({
  nodeId: z.uuid().nullable().default(null),
  timeZone: z.string().min(1).max(64).default("UTC"),
  message: z.unknown(),
});

const storable = (message: UIMessage) => JSON.parse(JSON.stringify(message.parts));

function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

export async function GET(request: NextRequest) {
  const asked = request.nextUrl.searchParams.get("node");
  if (asked !== null && !isUuid(asked)) return problem(400, "no such node");
  const nodeId = asked;
  const session = await sessionContext("chat", nodeId ?? undefined);
  if (!session.ok) return session.response;
  try {
    const off = chatProvider() === "off" ? AI_OFF_MESSAGE : null;
    return json({ ok: true, messages: await loadHistory(session.ctx.db, nodeId, SHOWN_MESSAGES), off });
  } catch (error) {
    console.error("chat history:", error instanceof Error ? error.message : error);
    return problem(500, "the conversation could not be loaded");
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return problem(403, "requests must come from this site");
  const asked = request.nextUrl.searchParams.get("node");
  if (asked !== null && !isUuid(asked)) return problem(400, "no such node");
  const nodeId = asked;
  const session = await sessionContext("chat", nodeId ?? undefined);
  if (!session.ok) return session.response;
  const { ctx } = session;
  if (nodeId) {
    const reachable = await ctx.db.from("nodes").select("id").eq("id", nodeId).maybeSingle();
    if (reachable.error || !reachable.data) return problem(404, "no such node");
  }
  const { error } = await serviceClient()
    .from("chat_messages")
    .insert({ owner_id: ctx.ownerId, node_id: nodeId, role: "system", parts: [{ type: "text", text: NEW_CHAT_MARK }] });
  if (error) {
    console.error("chat: new chat failed", error.message);
    return problem(500, "a new chat could not be started");
  }
  return json({ ok: true });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return problem(403, "requests must come from this site");
  const provider = chatProvider();
  if (provider === "off") return json({ ok: false, code: "off", message: AI_OFF_MESSAGE }, 503);
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
  if (!session.ok) return session.response;
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
  const continuing = message.role === "assistant";
  if (!continuing && message.role !== "user") return problem(422, "only the person's message is sent");
  if (message.parts.filter((part) => part.type === "file").length > 1) return problem(422, "attach one image per message");

  const service = serviceClient();
  const key = provider === "meta" ? await chooseKey(service, user.id) : ({ ok: true, apiKey: "", own: false } as const);
  if (!key.ok) {
    if (key.reason === "credits") return json({ ok: false, code: "credits", message: CREDITS_MESSAGE }, 402);
    return problem(503, "the chat is unavailable right now: try again");
  }
  if (!continuing && !key.own) {
    const taken = await takeUsageFor(service, user, "chat_message");
    if (!taken.allowed) {
      if (taken.reason === "error") return problem(503, "the chat is unavailable right now: try again");
      return json({ ok: false, code: "cap", message: capMessage(taken.reason, "chat_message") }, 429, {
        "Retry-After": String(secondsToNextDay()),
      });
    }
  }

  let history: UIMessage[];
  try {
    history = await loadHistory(ctx.db, nodeId);
  } catch (error) {
    console.error("chat:", error instanceof Error ? error.message : error);
    return problem(500, "the conversation could not be loaded");
  }
  const stored = continuing ? history.at(-1) : undefined;
  const continued = continuing ? continuedTurn(stored, message) : null;
  if (continuing && !continued) return problem(409, NOTHING_WAITING);
  if (stored && continued) {
    const taken = await service
      .from("chat_messages")
      .update({ parts: storable(continued) })
      .eq("id", stored.id)
      .eq("owner_id", ctx.ownerId)
      .contains("parts", JSON.stringify([openCall(stored)]))
      .select("id");
    if (taken.error) {
      console.error("chat: taking the turn failed", taken.error.message);
      return problem(500, "the conversation could not be loaded");
    }
    if (taken.data.length === 0) return problem(409, NOTHING_WAITING);
  }
  const messages = withoutEarlierFiles(continued ? [...history.slice(0, -1), continued] : [...history, message]);

  const { model, providerOptions } = chatModel(provider, key.apiKey);
  const countsOnServer = provider === "meta" && !key.own;
  const stream = await runChat({
    ctx,
    model,
    providerOptions,
    messages,
    timeZone: validTimeZone(parsed.data.timeZone),
    abortSignal: request.signal,
    onCost: countsOnServer ? (microUsd) => void addServerSpend(service, microUsd) : undefined,
    onEnd: async ({ responseMessage, isAborted }) => {
      const kept = isAborted ? whatWasDone(responseMessage) : responseMessage;
      if (isAborted && !stored && !kept.parts.some(isToolUIPart)) return;
      const saved = stored
        ? await service.from("chat_messages").update({ parts: storable(kept) }).eq("id", stored.id).eq("owner_id", ctx.ownerId)
        : await service.from("chat_messages").insert([message, kept].map((entry) => ({ owner_id: ctx.ownerId, node_id: nodeId, role: entry.role, parts: storable(entry) })));
      if (saved.error) console.error("chat: storing the turn failed", saved.error.message);
    },
  });
  return createUIMessageStreamResponse({ stream, headers: SESSION_HEADERS });
}
