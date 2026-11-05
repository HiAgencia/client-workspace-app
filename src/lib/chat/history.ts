import type { UIMessage } from "ai";
import type { Db } from "@/lib/db/client";

const HISTORY_MESSAGES = 10;
export const NEW_CHAT_MARK = "new-chat";

type Row = { id: string; role: string; parts: unknown };

export async function loadHistory(db: Db, nodeId: string | null, limit = HISTORY_MESSAGES): Promise<UIMessage[]> {
  const marks = db.from("chat_messages").select("seq").eq("role", "system");
  const marked = await (nodeId ? marks.eq("node_id", nodeId) : marks.is("node_id", null)).order("seq", { ascending: false }).limit(1).maybeSingle();
  if (marked.error) throw new Error(`reading the conversation: ${marked.error.message}`);
  const rows = db.from("chat_messages").select("id, role, parts").neq("role", "system");
  let read = nodeId ? rows.eq("node_id", nodeId) : rows.is("node_id", null);
  if (marked.data) read = read.gt("seq", marked.data.seq);
  const { data, error } = await read.order("seq", { ascending: false }).limit(limit);
  if (error) throw new Error(`reading the conversation: ${error.message}`);
  const window = (data as Row[]).reverse();
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
