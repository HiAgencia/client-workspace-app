import { isToolUIPart, type UIMessage } from "ai";






export const BROWSER_READS: ReadonlySet<string> = new Set(["list_mail", "count_unread_mail", "search_mail", "list_task_replies"]);

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
  const parts = stored.parts.map((part) => {
    if (!isToolUIPart(part) || isAnswered(part)) return part;
    const answer = answers.get(part.toolCallId)!;
    return answer.state === "output-available"
      ? ({ ...part, state: "output-available", output: answer.output } as AnyPart)
      : ({ ...part, state: "output-error", errorText: (answer as { errorText?: string }).errorText ?? "the read failed" } as AnyPart);
  });
  
  return { id: sent.id, role: "assistant", parts };
}
