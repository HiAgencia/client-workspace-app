import { isToolUIPart, type LanguageModel, type UIMessage, type UIMessageChunk } from "ai";
import { BROWSER_READS, continuedTurn } from "@/lib/chat/browser-reads";
import { runChat } from "@/lib/chat/run";
import type { ToolContext } from "@/lib/tools/context";
import { callTool } from "@/lib/tools/registry";

type Around = <T>(run: () => Promise<T>) => Promise<T>;
const asIs: Around = (run) => run();

async function consume(stream: ReadableStream<UIMessageChunk>) {
  const reader = stream.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

export async function chatTurn(options: { ctx: ToolContext; model: LanguageModel; messages: UIMessage[]; request?: Around; read?: Around }): Promise<UIMessage> {
  const { ctx, model, request = asIs, read = asIs } = options;
  let messages = options.messages;
  for (;;) {
    let stored: UIMessage | undefined;
    await request(async () => consume(await runChat({ ctx, model, messages, timeZone: "UTC", onEnd: ({ responseMessage }) => void (stored = responseMessage) })));
    if (!stored) throw new Error("the turn ended without its message");
    const open = stored.parts.filter((part) => isToolUIPart(part) && part.state === "input-available");
    if (open.length === 0) return stored;
    const answers = new Map<string, unknown>();
    for (const part of open) {
      if (!isToolUIPart(part)) continue;
      const name = part.type.replace(/^tool-/, "");
      if (!BROWSER_READS.has(name)) throw new Error(`${name} stopped the turn and no browser runs it`);
      answers.set(part.toolCallId, await read(() => callTool(name, { ...ctx, source: "manual" }, part.input)));
    }
    const sent = {
      id: stored.id,
      role: "assistant" as const,
      parts: stored.parts.map((part) => (isToolUIPart(part) && answers.has(part.toolCallId) ? { ...part, state: "output-available", output: answers.get(part.toolCallId) } : part)),
    } as UIMessage;
    const continued = continuedTurn(stored, sent);
    if (!continued) throw new Error("the server would refuse this continuation");
    messages = [...messages.filter((message) => message.id !== stored!.id), continued];
  }
}
