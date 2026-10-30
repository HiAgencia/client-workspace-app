import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { count } from "@/lib/count";





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


function workspaceWide(prompt: LanguageModelV4Prompt): boolean {
  return prompt.some((message) => message.role === "system" && message.content.includes("No node is open"));
}


function personDay(prompt: LanguageModelV4Prompt): { today: string; zone: string } {
  const system = prompt.find((message) => message.role === "system");
  const named = system?.role === "system" ? system.content.match(/\(time zone ([^)]+)\)/)?.[1] : undefined;
  let zone = "UTC";
  try {
    if (named) {
      new Intl.DateTimeFormat("en", { timeZone: named });
      zone = named;
    }
  } catch {
    zone = "UTC";
  }
  
  return { today: new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), zone };
}

function hasImage(prompt: LanguageModelV4Prompt): boolean {
  const last = [...prompt].reverse().find((message) => message.role === "user");
  return Boolean(last && last.role === "user" && last.content.some((part) => part.type === "file"));
}


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


export function script(prompt: LanguageModelV4Prompt): LanguageModelV4StreamPart[] {
  const results = toolResults(prompt);
  if (results.length > 0) {
    const summary = results
      .map(({ toolName, output }) => {
        const value = (
          output as {
            value?: {
              ok?: boolean;
              item?: { title?: string };
              openTasks?: Array<{ title: string }>;
              items?: Array<{ title: string }>;
              actions?: Array<{ kind: string }>;
              message?: string;
            };
          }
        ).value;
        if (value?.ok === false) return `I could not do that: ${value.message}`;
        if (toolName === "run_daily_review") {
          const actions = value?.actions ?? [];
          const completed = actions.filter((action) => action.kind === "complete").length;
          const states = actions.filter((action) => action.kind === "mail_status").length;
          if (actions.length === 0) return "I reviewed your day: nothing needed a change.";
          const parts = [
            ...(completed ? [`completed ${count(completed, "task", "tasks")}`] : []),
            ...(states ? [`wrote the mail's state of ${count(states, "task", "tasks")}`] : []),
          ];
          return `I reviewed your day: I ${parts.join(" and ")}. Each change has its undo below.`;
        }
        if (toolName === "get_overview" || toolName === "browse_items") {
          const open = (toolName === "get_overview" ? value?.openTasks : value?.items) ?? [];
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
  
  if (/\breview (?:my|the|today'?s?) ?day\b|\bdaily review\b|\breview (?:my|the) (?:tasks|mail)\b/i.test(request)) {
    return call("run_daily_review", personDay(prompt));
  }
  
  
  const task = request.match(/(?:create|add|new) (?:a )?task(?: (?:in|for) (.+?) to[:\s]+| to[:\s]+|[:\s]+)(.+)/i);
  if (task) return call("create_task", { ...(task[1] ? { node: task[1].trim() } : {}), title: task[2].replace(/[.\s]+$/, "") });
  const decision = request.match(/(?:decided|decision)[:\s]+(.+)/i);
  if (decision) return call("add_decision", { decision: decision[1].replace(/[.\s]+$/, "") });
  if (hasImage(prompt)) return call("create_task", { title: "Follow up on the attached screenshot" });
  
  if (/pending|what('s| is) (left|next)|advise|what should/i.test(request)) {
    return workspaceWide(prompt) ? call("browse_items", { type: ["task"], status: "open", sort: "priority", limit: 5 }) : call("get_overview", {});
  }
  return text(`(simulated model) You said: ${request}`);
}

export function simulatedModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "simulated",
    modelId: "scripted",
    doStream: async ({ prompt }) => ({ stream: simulateReadableStream({ chunks: script(prompt) }) }),
  });
}
