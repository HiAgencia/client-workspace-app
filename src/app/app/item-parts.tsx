import type { SelectOption } from "@/components/ui/select";
import type { Item } from "./client-api";
import { ASSISTANT_NAME } from "@/lib/product";
import { translateNow, type StringKey } from "@/lib/strings";
import { demoSender, nameSeed, OrgMark, Portrait } from "./sender-art";

export const PRIORITIES: SelectOption[] = [
  { value: "1", label: "Urgent", tone: "alert" },
  { value: "2", label: "High", tone: "warn" },
  { value: "3", label: "Normal", tone: "neutral" },
  { value: "4", label: "Low", tone: "muted" },
];

export const TYPE_NAMES: Record<Item["type"], string> = { task: "Task", note: "Note", decision: "Decision" };

const PRIORITY_KEYS: Record<string, StringKey> = { "1": "priority.urgent", "2": "priority.high", "3": "priority.normal", "4": "priority.low" };
const TYPE_KEYS: Record<Item["type"], StringKey> = { task: "type.task", note: "type.note", decision: "type.decision" };

export function priorityOptions(): SelectOption[] {
  return PRIORITIES.map((option) => ({ ...option, label: translateNow(PRIORITY_KEYS[option.value]) }));
}

export function typeName(type: Item["type"]): string {
  return translateNow(TYPE_KEYS[type]);
}

export function PathText({ path }: { path: string }) {
  const places = path.split(" / ");
  return (
    <span className="path-text">
      {places.map((place, index) => (
        <span key={index}>
          {index > 0 && " "}
          <span className="nowrap">{index < places.length - 1 ? `${place} /` : place}</span>
        </span>
      ))}
    </span>
  );
}

export function sourceName(source: Item["source"], agentLabel: string | null): string {
  if (source === "manual") return translateNow("source.byYou");
  if (source === "chat") return translateNow("source.byAssistant", { assistant: ASSISTANT_NAME });
  if (source === "review") return translateNow("source.automatically");
  return agentLabel ? translateNow("source.byAgentNamed", { label: agentLabel }) : translateNow("source.byAgent");
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

export function SenderMark({ name, email }: { name: string; email?: string | null }) {
  const seed = nameSeed(name);
  const color = SENDER_COLORS[seed % SENDER_COLORS.length];
  const drawn = demoSender(email);
  if (drawn === "person") {
    return (
      <span className="sender-mark" data-art="person" data-color={color} aria-hidden="true">
        <Portrait seed={seed} />
      </span>
    );
  }
  if (drawn) {
    return (
      <span className="sender-mark" data-art="org" aria-hidden="true">
        <OrgMark sign={drawn} />
      </span>
    );
  }
  const letter = (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toLocaleUpperCase();
  return (
    <span className="sender-mark" data-color={color} aria-hidden="true">
      {letter}
    </span>
  );
}
