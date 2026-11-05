import { countedNow, translateNow } from "@/lib/strings";

export type DeletedWith = { subtasks: number; notes: number; decisions: number };

export function broughtBack(deletedWith: DeletedWith): string | null {
  const parts = [
    deletedWith.subtasks > 0 ? countedNow(deletedWith.subtasks, "counted.subtask", "counted.subtasks") : null,
    deletedWith.notes > 0 ? countedNow(deletedWith.notes, "counted.note", "counted.notes") : null,
    deletedWith.decisions > 0 ? countedNow(deletedWith.decisions, "counted.decision", "counted.decisions") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}${translateNow("quick.and")}${parts.at(-1)}`;
}
