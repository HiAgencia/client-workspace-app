import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

// The chat without spend: a scripted model that reads the last request and calls the tool a real model would
// (create a task, record a decision, look up what is pending), then says what it did. It lets the whole chat —
// tools, cards, undo, the cap— be built and tested without credits.

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

function lastUserText(prompt: LanguageModelV4Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role !== "user") continue;
    return message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

function hasImage(prompt: LanguageModelV4Prompt): boolean {
  const last = [...prompt].reverse().find((message) => message.role === "user");
  return Boolean(last && last.role === "user" && last.content.some((part) => part.type === "file"));
}

// The tool results of the current turn: everything after the last user message.
function toolResults(prompt: LanguageModelV4Prompt): Array<{ toolName: string; output: unknown }> {
  const lastUser = prompt.map((message) => message.role).lastIndexOf("user");
  return prompt.slice(lastUser + 1).flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) => (part.type === "tool-result" ? [{ toolName: part.toolName, output: part.output }] : []))
      : [],
  );
}

function text(value: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: value },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
}

function call(toolName: string, input: Record<string, unknown>): LanguageModelV4StreamPart[] {
  return [
    { type: "tool-call", toolCallId: `call-${toolName}-${Date.now()}`, toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ];
}

// What the scripted model does with a request: a tool call, or plain text.
export function script(prompt: LanguageModelV4Prompt): LanguageModelV4StreamPart[] {
  const results = toolResults(prompt);
  if (results.length > 0) {
    const summary = results
      .map(({ toolName, output }) => {
        const value = (output as { value?: { ok?: boolean; item?: { title?: string }; openTasks?: Array<{ title: string }>; message?: string } }).value;
        if (value?.ok === false) return `I could not do that: ${value.message}`;
        if (toolName === "get_overview") {
          const open = value?.openTasks ?? [];
          return open.length === 0
            ? "Nothing is pending here."
            : `Pending here: ${open.map((task) => task.title).join("; ")}. Start with "${open[0].title}".`;
        }
        return `Done: ${toolName.replace(/_/g, " ")} "${value?.item?.title ?? ""}".`;
      })
      .join(" ");
    return text(summary);
  }

  const request = lastUserText(prompt);
  const task = request.match(/(?:create|add|new) (?:a )?task(?: to)?[:\s]+(.+)/i);
  if (task) return call("create_task", { title: task[1].replace(/[.\s]+$/, "") });
  const decision = request.match(/(?:decided|decision)[:\s]+(.+)/i);
  if (decision) return call("add_decision", { decision: decision[1].replace(/[.\s]+$/, "") });
  if (hasImage(prompt)) return call("create_task", { title: "Follow up on the attached screenshot" });
  if (/pending|what('s| is) (left|next)|advise|what should/i.test(request)) return call("get_overview", {});
  return text(`(simulated model) You said: ${request}`);
}

export function simulatedModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "simulated",
    modelId: "scripted",
    doStream: async ({ prompt }) => ({ stream: simulateReadableStream({ chunks: script(prompt) }) }),
  });
}
