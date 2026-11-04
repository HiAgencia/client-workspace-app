import { count } from "@/lib/count";

export type DeletedWith = { subtasks: number; notes: number; decisions: number };

export function broughtBack(deletedWith: DeletedWith): string | null {
  const parts = [
    deletedWith.subtasks > 0 ? count(deletedWith.subtasks, "subtask", "subtasks") : null,
    deletedWith.notes > 0 ? count(deletedWith.notes, "note", "notes") : null,
    deletedWith.decisions > 0 ? count(deletedWith.decisions, "decision", "decisions") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
