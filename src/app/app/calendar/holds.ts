import { count } from "@/lib/count";

export function holds(events: number, tasks: number): string {
  if (events > 0 && tasks > 0) return `${count(events, "event", "events")} and ${count(tasks, "task", "tasks")}`;
  return events > 0 ? count(events, "event", "events") : count(tasks, "task", "tasks");
}
