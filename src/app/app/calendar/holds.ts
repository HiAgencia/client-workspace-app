import { countedNow, translateNow } from "@/lib/strings";

export function holds(events: number, tasks: number): string {
  if (events > 0 && tasks > 0) return translateNow("calPage.holdsJoin", { events: countedNow(events, "counted.event", "counted.events"), tasks: countedNow(tasks, "counted.task", "counted.tasks") });
  return events > 0 ? countedNow(events, "counted.event", "counted.events") : countedNow(tasks, "counted.task", "counted.tasks");
}
