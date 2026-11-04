import { inlinePlain } from "@/lib/inline-links";

export function subjectOf(message: { subject: string }): string {
  return message.subject.trim() || "(No subject)";
}

export function taskLine(message: { tasks: Array<{ title: string; status: "open" | "done" }> }): { text: string; done: boolean } | null {
  const open = message.tasks.find((task) => task.status === "open");
  const task = open ?? message.tasks[0];
  if (!task) return null;
  return { text: `${open ? "For" : "Completed task"}: ${inlinePlain(task.title)}`, done: !open };
}
