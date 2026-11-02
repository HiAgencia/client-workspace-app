import type { SelectOption } from "@/components/ui/select";
import type { Item } from "./client-api";




export const PRIORITIES: SelectOption[] = [
  { value: "1", label: "Urgent", tone: "alert" },
  { value: "2", label: "High", tone: "warn" },
  { value: "3", label: "Normal", tone: "neutral" },
  { value: "4", label: "Low", tone: "muted" },
];

export const TYPE_NAMES: Record<Item["type"], string> = { task: "Task", note: "Note", decision: "Decision" };




export function PathText({ path }: { path: string }) {
  return (
    <span>
      {path.split(" / ").map((place, index) => (
        <span key={index}>
          {index > 0 && " "}
          <span className="nowrap">{index > 0 ? `/ ${place}` : place}</span>
        </span>
      ))}
    </span>
  );
}



export function sourceName(source: Item["source"], agentLabel: string | null): string {
  if (source === "manual") return "By hand";
  if (source === "chat") return "By the chat";
  if (source === "review") return "By the daily review";
  return agentLabel ? `By an agent: ${agentLabel}` : "By an agent";
}


export function Origin({ item }: { item: Item }) {
  if (item.source === "manual") return null;
  return (
    <span className="pill" data-tone={item.source === "chat" ? "accent" : "info"}>
      {sourceName(item.source, item.agentLabel)}
    </span>
  );
}



const SENDER_COLORS = ["blue", "violet", "teal", "amber", "pink", "indigo", "green", "orange"] as const;

export function SenderMark({ name }: { name: string }) {
  const letter = (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toLocaleUpperCase();
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  return (
    <span className="sender-mark" data-color={SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length]} aria-hidden="true">
      {letter}
    </span>
  );
}
