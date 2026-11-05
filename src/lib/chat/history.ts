import type { UIMessage } from "ai";
import type { Db } from "@/lib/db/client";

const HISTORY_MESSAGES = 10;
const READ_BACK = 200;
export const NEW_CHAT_MARK = "new-chat";

type Row = { id: string; role: string; parts: unknown; seq: number };

const isMark = (row: Row) =>
  row.role === "system" && Array.isArray(row.parts) && (row.parts as Array<{ text?: unknown }>).some((part) => part?.text === NEW_CHAT_MARK);

export async function loadHistory(db: Db, nodeId: string | null, limit = HISTORY_MESSAGES): Promise<UIMessage[]> {
  const base = db.from("chat_messages").select("id, role, parts, seq");
  const { data, error } = await (nodeId ? base.eq("node_id", nodeId) : base.is("node_id", null))
    .order("seq", { ascending: false })
    .limit(Math.max(limit, READ_BACK));
  if (error) throw new Error(`reading the conversation: ${error.message}`);
  const newestFirst = data as Row[];
  const mark = newestFirst.findIndex(isMark);
  const current = (mark === -1 ? newestFirst : newestFirst.slice(0, mark)).filter((row) => row.role !== "system");
  const window = current.slice(0, limit).reverse();
  const first = window.findIndex((row) => row.role === "user");
  return (first === -1 ? window : window.slice(first)).map((row) => ({ id: row.id, role: row.role as UIMessage["role"], parts: row.parts as UIMessage["parts"] }));
}

export function withoutEarlierFiles(messages: UIMessage[]): UIMessage[] {
  const turn = messages.map((message) => message.role).lastIndexOf("user");
  return messages.map((message, index) =>
    index >= turn
      ? message
      : {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "file"
              ? { type: "text" as const, text: `[an attachment was sent here: ${part.filename ?? part.mediaType}]` }
              : part,
          ),
        },
  );
}
