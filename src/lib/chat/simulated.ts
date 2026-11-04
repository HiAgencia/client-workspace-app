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

const ARRIVED = /\b(?:arriv\w*|llegó|llego)\b|\brepl(?:y|ies) (?:to|for) (?:my|the) tasks?\b|\brespuestas? (?:a|de|para) mis tareas\b/i;

type TaskRows = { groups?: { overdue?: { tasks: WaitingRow[] }; today?: { tasks: WaitingRow[] }; noDate?: { tasks: WaitingRow[] }; upcoming?: { days: Array<{ tasks: WaitingRow[] }> } } };
type WaitingRow = { id: string; title: string; mail: { waitsFor: string } | null };
type Replies = { task?: { id: string; title: string }; accounts?: Array<{ id: string }>; toRead?: string[]; replies?: Array<{ subject: string; from: { name: string | null; email: string } }> };

const CALENDAR = /\b(?:on (?:my|the) calendars?|en (?:mi|el) calendario|en mis calendarios)\b/i;

type EventsRead = { ok?: boolean; message?: string; accounts?: Array<{ id: string }>; toRead?: string[]; events?: Array<{ title: string }>; failures?: Array<{ accountEmail: string; reason: string }> };

function weekAhead(prompt: LanguageModelV4Prompt) {
  const { today } = personDay(prompt);
  const from = Date.parse(`${today}T00:00:00Z`);
  const toDay = new Date(from + 7 * 86_400_000).toISOString().slice(0, 10);
  return { from: `${today}T00:00:00Z`, to: `${toDay}T00:00:00Z`, fromDay: today, toDay };
}

const CLOSE = /\b(?:close|complete|cerr[aá]|complet[aá])\s+(?:the task\s+|la tarea\s+)?["“«]?(.+?)["”»]?\s+(?:as|como)\s+(.+?)[.!]*$/i;

function waitingTasks(value: TaskRows | undefined): WaitingRow[] {
  const groups = value?.groups;
  const rows = [...(groups?.overdue?.tasks ?? []), ...(groups?.today?.tasks ?? []), ...(groups?.noDate?.tasks ?? []), ...(groups?.upcoming?.days ?? []).flatMap((entry) => entry.tasks)];
  return rows.filter((row) => row.mail);
}

export function script(prompt: LanguageModelV4Prompt): LanguageModelV4StreamPart[] {
  const results = toolResults(prompt);
  const request = lastUserText(prompt);
  if (ARRIVED.test(request) && results.some((result) => result.toolName === "list_task_replies")) {
    const answers = results.filter((result) => result.toolName === "list_task_replies").map(({ output }) => (output as { value?: Replies & { ok?: boolean; message?: string } }).value);
    const read = new Set(answers.flatMap((value) => (value?.task && !value.toRead?.length ? (value.accounts ?? []).map((account) => `${value.task!.id}:${account.id}`) : [])));
    const toRead = answers.flatMap((value) => (value?.task ? (value.toRead ?? []).filter((account) => !read.has(`${value.task!.id}:${account}`)).map((account) => ({ toolName: "list_task_replies", input: { task: value.task!.id, account } })) : []));
    if (toRead.length > 0) return calls(...toRead);
    const byTask = new Map<string, { title: string; replies: NonNullable<Replies["replies"]> }>();
    const failed: string[] = [];
    for (const value of answers) {
      if (value?.ok === false) failed.push(`I could not read one task's mail: ${value.message}`);
      if (!value?.task) continue;
      const entry = byTask.get(value.task.id) ?? { title: value.task.title, replies: [] };
      entry.replies.push(...(value.replies ?? []));
      byTask.set(value.task.id, entry);
    }
    const lines = [...byTask.values()].map(({ title, replies }) => {
      if (replies.length === 0) return `"${title}": nothing has arrived yet.`;
      const latest = replies[0];
      return `"${title}": ${count(replies.length, "possible reply", "possible replies")}, the latest "${latest.subject}" from ${latest.from.name ?? latest.from.email}.`;
    });
    return text(`${[...failed, ...lines].join(" ")} Open a task to see them and say which one answers it.`);
  }
  if (ARRIVED.test(request) && results.some((result) => result.toolName === "get_tasks")) {
    const answer = results.find((result) => result.toolName === "get_tasks")!;
    const waiting = waitingTasks((answer.output as { value?: TaskRows }).value);
    if (waiting.length === 0) return text("No task waits for mail.");
    return calls(...waiting.map((task) => ({ toolName: "list_task_replies", input: { task: task.id } })));
  }
  if (CALENDAR.test(request) && results.some((result) => result.toolName === "browse_events")) {
    const answers = results.filter((result) => result.toolName === "browse_events").map(({ output }) => (output as { value?: EventsRead }).value);
    const read = new Set(answers.flatMap((value) => (value?.toRead?.length ? [] : (value?.accounts ?? []).map((account) => account.id))));
    const toRead = answers.flatMap((value) => value?.toRead ?? []).filter((account) => !read.has(account));
    if (toRead.length > 0) return calls(...toRead.map((account) => ({ toolName: "browse_events", input: { ...weekAhead(prompt), account } })));
    const titles = answers.flatMap((value) => (value?.events ?? []).map((event) => event.title));
    const failed = answers.flatMap((value) => (value?.ok === false ? [`I could not read the calendars: ${value.message}`] : (value?.failures ?? []).map((failure) => `The calendar of ${failure.accountEmail} could not be read: ${failure.reason}.`)));
    return text([...failed, titles.length === 0 ? "Nothing is on the calendars this week." : `This week: ${titles.join("; ")}.`].join(" "));
  }
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

  const task = request.match(/(?:create|add|new) (?:a )?task(?: (?:in|for) (.+?) to[:\s]+| to[:\s]+|[:\s]+)(.+)/i);
  if (task) return call("create_task", { ...(task[1] ? { node: task[1].trim() } : {}), title: task[2].replace(/[.\s]+$/, "") });
  const decision = request.match(/(?:decided|decision)[:\s]+(.+)/i);
  if (decision) return call("add_decision", { decision: decision[1].replace(/[.\s]+$/, "") });
  if (hasImage(prompt)) return call("create_task", { title: "Follow up on the attached screenshot" });
  if (ARRIVED.test(request)) return call("get_tasks", { today: personDay(prompt).today });
  if (CALENDAR.test(request)) return call("browse_events", weekAhead(prompt));
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
