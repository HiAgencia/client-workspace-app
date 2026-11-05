import type { Day } from "./dates";

export type TaskDraft = {
  title: string;
  day: Day | null;
  time: string | null;
  placeId: string | null;
  parentId?: string | null;
  priority: number;
  description: string;
  subtasks: string[];
  notes: string[];
};

export type TaskPayload = {
  title: string;
  node: string | null;
  parent?: string;
  priority: number;
  notes?: string;
  dueOn?: Day;
  dueTime?: string;
  subtasks: string[];
  notesToAdd: string[];
};

const words = (value: string) => value.replace(/\s+/g, " ").trim();

export function linesOf(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function taskPayload(draft: TaskDraft): TaskPayload {
  const description = draft.description.trim();
  return {
    title: words(draft.title),
    node: draft.placeId,
    ...(draft.parentId ? { parent: draft.parentId } : {}),
    priority: draft.priority,
    ...(description ? { notes: description } : {}),
    ...(draft.day ? { dueOn: draft.day } : {}),
    ...(draft.day && draft.time ? { dueTime: draft.time } : {}),
    subtasks: draft.subtasks.map((line) => line.trim()).filter(Boolean),
    notesToAdd: draft.notes.map((line) => line.trim()).filter(Boolean),
  };
}
