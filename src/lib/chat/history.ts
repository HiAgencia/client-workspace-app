import type { UIMessage } from "ai";
import type { Db } from "@/lib/db/client";

// The model reads the most recent turns of the node's conversation, built on the server from what was stored, never
// from what the browser sends: the browser sends only the new message.
export const HISTORY_MESSAGES = 30;

type Row = { id: string; role: string; parts: unknown; seq: number };

export async function loadHistory(db: Db, nodeId: string, limit = HISTORY_MESSAGES): Promise<UIMessage[]> {
  const { data, error } = await db
    .from("chat_messages")
    .select("id, role, parts, seq")
    .eq("node_id", nodeId)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`reading the conversation: ${error.message}`);
  return (data as Row[])
    .reverse()
    .map((row) => ({ id: row.id, role: row.role as UIMessage["role"], parts: row.parts as UIMessage["parts"] }));
}

// An image is read in the turn it arrives; later turns carry a note instead, so one large image does not travel with
// every following message.
export function withoutEarlierFiles(messages: UIMessage[]): UIMessage[] {
  return messages.map((message, index) =>
    index === messages.length - 1
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
