import type { SelectOption } from "@/components/ui/select";
import type { Item } from "./client-api";

// The names an item is shown with, from one source: the rows, the quick add, the palette and the detail panel read them
// here. The panel lives apart from the rows so importing it never pulls the workspace into itself.

export const PRIORITIES: SelectOption[] = [
  { value: "1", label: "Urgent", tone: "alert" },
  { value: "2", label: "High", tone: "warn" },
  { value: "3", label: "Normal", tone: "neutral" },
  { value: "4", label: "Low", tone: "muted" },
];

export const TYPE_NAMES: Record<Item["type"], string> = { task: "Task", note: "Note", decision: "Decision", link: "Link", review: "To review" };

// Who wrote it, in words: what the chat or an agent did reads apart from what the person typed.
export function Origin({ item }: { item: Item }) {
  if (item.source === "manual") return null;
  return (
    <span className="pill" data-tone={item.source === "chat" ? "accent" : "info"}>
      {item.source === "chat" ? "By the chat" : `By agent ${item.agentLabel}`}
    </span>
  );
}
