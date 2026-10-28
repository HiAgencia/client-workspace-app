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

// A client's or a project's path, which breaks only between its places: a name never splits across lines, and a word of
// it is never left alone on one. It is one run of text whatever holds it: inside a flex link or row each place would be a
// box of its own, and the space before each slash would drop.
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

// Who wrote something, in the words every list and filter uses: an agent says the name of its token.
export function sourceName(source: Item["source"], agentLabel: string | null): string {
  if (source === "manual") return "By hand";
  if (source === "chat") return "By the chat";
  return agentLabel ? `By an agent · ${agentLabel}` : "By an agent";
}

// Who wrote it: what the chat or an agent did reads apart from what the person typed.
export function Origin({ item }: { item: Item }) {
  if (item.source === "manual") return null;
  return (
    <span className="pill" data-tone={item.source === "chat" ? "accent" : "info"}>
      {sourceName(item.source, item.agentLabel)}
    </span>
  );
}
