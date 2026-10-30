import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { count } from "@/lib/count";

// The chat without spend: a scripted model that reads the last request and calls the tool a real model would
// (create a task, record a decision, look up what is pending, read what arrived for the tasks that wait for mail), then
// says what it did. It lets the whole chat —tools, cards, undo, the cap— be built and tested without credits. Like the
// real one, it acts only on what the person asks.

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

// The system prompt says when no node is open: the conversation covers the whole workspace.
function workspaceWide(prompt: LanguageModelV4Prompt): boolean {
  return prompt.some((message) => message.role === "system" && message.content.includes("No node is open"));
}

// The person's calendar day and zone, read from the system prompt's «(time zone …)», as a real model reads them there.
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
  // The Canadian English short date is the calendar day as YYYY-MM-DD.
  return { today: new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), zone };
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

function calls(...wanted: Array<{ toolName: string; input: Record<string, unknown> }>): LanguageModelV4StreamPart[] {
  return [
    ...wanted.map(({ toolName, input }, index): LanguageModelV4StreamPart => ({
      type: "tool-call",
      toolCallId: `call-${toolName}-${Date.now()}-${index}`,
      toolName,
      input: JSON.stringify(input),
    })),
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ];
}

const call = (toolName: string, input: Record<string, unknown>) => calls({ toolName, input });

// «Did anything arrive for my tasks?», in either language the person writes.
const ARRIVED = /\b(?:arriv\w*|llegó|llego)\b|\brepl(?:y|ies) (?:to|for) (?:my|the) tasks?\b|\brespuestas? (?:a|de|para) mis tareas\b/i;

type TaskRows = { groups?: { overdue?: { tasks: WaitingRow[] }; today?: { tasks: WaitingRow[] }; noDate?: { tasks: WaitingRow[] }; upcoming?: { days: Array<{ tasks: WaitingRow[] }> } } };
type WaitingRow = { id: string; title: string; mail: { waitsFor: string } | null };
type Replies = { task?: { title: string }; replies?: Array<{ subject: string; from: { name: string | null; email: string } }> };

// «Close “Wait for the app review approval” as approved», in either language: the person names the task and its result.
const CLOSE = /\b(?:close|complete|cerr[aá]|complet[aá])\s+(?:the task\s+|la tarea\s+)?["“«]?(.+?)["”»]?\s+(?:as|como)\s+(.+?)[.!]*$/i;

// The tasks of a `get_tasks` answer that wait for mail.
function waitingTasks(value: TaskRows | undefined): WaitingRow[] {
  const groups = value?.groups;
  const rows = [...(groups?.overdue?.tasks ?? []), ...(groups?.today?.tasks ?? []), ...(groups?.noDate?.tasks ?? []), ...(groups?.upcoming?.days ?? []).flatMap((entry) => entry.tasks)];
  return rows.filter((row) => row.mail);
}

// What the scripted model does with a request: a tool call, or plain text.
export function script(prompt: LanguageModelV4Prompt): LanguageModelV4StreamPart[] {
  const results = toolResults(prompt);
  const request = lastUserText(prompt);
  // What arrived for the tasks: first the tasks that wait for mail, then the possible replies of each; the person decides
  // which one answers a task.
  if (ARRIVED.test(request) && results.some((result) => result.toolName === "list_task_replies")) {
    const lines = results
      .filter((result) => result.toolName === "list_task_replies")
      .map(({ output }) => {
        const value = (output as { value?: Replies & { ok?: boolean; message?: string } }).value;
        if (value?.ok === false) return `I could not read one task's mail: ${value.message}`;
        const replies = value?.replies ?? [];
        if (replies.length === 0) return `"${value?.task?.title}": nothing has arrived yet.`;
        const latest = replies[0];
        return `"${value?.task?.title}": ${count(replies.length, "possible reply", "possible replies")}, the latest "${latest.subject}" from ${latest.from.name ?? latest.from.email}.`;
      });
    return text(`${lines.join(" ")} Open a task to see them and say which one answers it.`);
  }
  if (ARRIVED.test(request) && results.some((result) => result.toolName === "get_tasks")) {
    const answer = results.find((result) => result.toolName === "get_tasks")!;
    const waiting = waitingTasks((answer.output as { value?: TaskRows }).value);
    if (waiting.length === 0) return text("No task waits for mail.");
    return calls(...waiting.map((task) => ({ toolName: "list_task_replies", input: { task: task.id } })));
  }
  // Closing a task the person named, with the result they said: it is found by its exact title among the open tasks, and
  // a title that matches none closes nothing.
  const closing = request.match(CLOSE);
  if (closing && !results.some((result) => result.toolName === "complete_task")) {
    const title = closing[1].trim();
    const found = results.find((result) => result.toolName === "search_items");
    if (!found) return call("search_items", { query: title, type: "task", status: "open" });
    const items = (found.output as { value?: { items?: Array<{ id: string; title: string }> } }).value?.items ?? [];
    const task = items.find((item) => item.title.toLowerCase() === title.toLowerCase());
    if (!task) return text(`No open task is called "${title}", so nothing was closed.`);
    return call("complete_task", { task: task.id, outcome: closing[2].trim() });
  }
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
              message?: string;
            };
          }
        ).value;
        if (value?.ok === false) return `I could not do that: ${value.message}`;
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

  // "Create a task in Larkspur Bakery / Website to call the printer" names where it goes; without it, the open node takes
  // it.
  const task = request.match(/(?:create|add|new) (?:a )?task(?: (?:in|for) (.+?) to[:\s]+| to[:\s]+|[:\s]+)(.+)/i);
  if (task) return call("create_task", { ...(task[1] ? { node: task[1].trim() } : {}), title: task[2].replace(/[.\s]+$/, "") });
  const decision = request.match(/(?:decided|decision)[:\s]+(.+)/i);
  if (decision) return call("add_decision", { decision: decision[1].replace(/[.\s]+$/, "") });
  if (hasImage(prompt)) return call("create_task", { title: "Follow up on the attached screenshot" });
  // The tasks of the person's day, to read the possible replies of those that wait for mail.
  if (ARRIVED.test(request)) return call("get_tasks", { today: personDay(prompt).today });
  // With a node open it reads that node; over the whole workspace, the most urgent open tasks of everything.
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
