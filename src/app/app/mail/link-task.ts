import { prepare, rank } from "@/lib/fuzzy";
import { inlinePlain } from "@/lib/inline-links";




export type LinkCandidate = { id: string; title: string; path?: string | null };

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function tasksMatching<T extends LinkCandidate>(tasks: T[], query: string): T[] {
  const typed = query.trim();
  if (!typed) return tasks;
  const wanted = plain(typed);
  const texts = tasks.map((task) => ({ task, text: `${inlinePlain(task.title)} ${task.path ?? ""}` }));
  const inside = texts.filter(({ text }) => plain(text).includes(wanted)).map(({ task }) => task);
  const found = new Set(inside.map((task) => task.id));
  const forgiven = rank(typed, texts.map((entry) => ({ ...entry, prepared: prepare(entry.text) })), (entry) => entry.prepared)
    .map((hit) => hit.entry.task)
    .filter((task) => !found.has(task.id));
  return [...inside, ...forgiven];
}
