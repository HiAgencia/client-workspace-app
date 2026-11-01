import { isToolUIPart, type UIMessage } from "ai";






export const BROWSER_READS: ReadonlySet<string> = new Set(["list_mail", "count_unread_mail", "search_mail", "list_task_replies"]);


export const MAX_READ_ANSWER = 256 * 1024;
const MAX_READ_ERROR = 500;

type AnyPart = UIMessage["parts"][number];

const toolNameOf = (part: AnyPart) => part.type.replace(/^tool-/, "");
const isBrowserRead = (part: AnyPart) => isToolUIPart(part) && BROWSER_READS.has(toolNameOf(part));
const isAnswered = (part: AnyPart) => isToolUIPart(part) && (part.state === "output-available" || part.state === "output-error");


function lastStep(message: UIMessage): AnyPart[] {
  const start = message.parts.reduce((last, part, index) => (part.type === "step-start" ? index : last), -1);
  return message.parts.slice(start + 1);
}



export function turnGoesOn({ messages }: { messages: UIMessage[] }): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  const calls = lastStep(last).filter(isToolUIPart);
  return calls.some(isBrowserRead) && calls.every(isAnswered);
}


export function stepsTaken(messages: UIMessage[]): number {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last.parts.filter((part) => part.type === "step-start").length : 0;
}





export function continuedTurn(stored: UIMessage | undefined, sent: UIMessage): UIMessage | null {
  if (stored?.role !== "assistant") return null;
  const open = stored.parts.filter((part) => isToolUIPart(part) && !isAnswered(part));
  if (open.length === 0 || !open.every(isBrowserRead)) return null;
  const answers = new Map(sent.parts.filter(isToolUIPart).map((part) => [part.toolCallId, part]));
  const answered = open.every((part) => isToolUIPart(part) && isAnswered(answers.get(part.toolCallId) ?? part));
  if (!answered) return null;
  const failed = (part: AnyPart, errorText: string) => ({ ...part, state: "output-error", errorText }) as AnyPart;
  const parts = stored.parts.map((part) => {
    if (!isToolUIPart(part) || isAnswered(part)) return part;
    const answer = answers.get(part.toolCallId)!;
    if (answer.state !== "output-available") return failed(part, String((answer as { errorText?: unknown }).errorText ?? "the read failed").slice(0, MAX_READ_ERROR));
    if (JSON.stringify(answer.output ?? null).length > MAX_READ_ANSWER) return failed(part, "the read brought too much: ask for less of it");
    return { ...part, state: "output-available", output: answer.output } as AnyPart;
  });
  
  return { id: sent.id, role: "assistant", parts };
}
