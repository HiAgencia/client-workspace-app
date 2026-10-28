import type { UIMessage } from "ai";
import type { Db } from "@/lib/db/client";

// The model reads the most recent turns of the conversation, built on the server from what was stored, never from what
// the browser sends: the browser sends only the new message. A node keeps its conversation, and the whole workspace keeps
// one of its own (no node); row-level security reads only the signed-in person's.
export const HISTORY_MESSAGES = 30;

type Row = { id: string; role: string; parts: unknown; seq: number };

export async function loadHistory(db: Db, nodeId: string | null, limit = HISTORY_MESSAGES): Promise<UIMessage[]> {
  const base = db.from("chat_messages").select("id, role, parts, seq");
  const { data, error } = await (nodeId ? base.eq("node_id", nodeId) : base.is("node_id", null))
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
