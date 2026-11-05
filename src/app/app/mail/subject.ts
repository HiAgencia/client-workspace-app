import { inlinePlain } from "@/lib/inline-links";
import { translateNow } from "@/lib/strings";

export function subjectOf(message: { subject: string }): string {
  return message.subject.trim() || translateNow("mailPage.noSubject");
}

export function taskLine(message: { tasks: Array<{ title: string; status: "open" | "done" }> }): { text: string; done: boolean } | null {
  const open = message.tasks.find((task) => task.status === "open");
  const task = open ?? message.tasks[0];
  if (!task) return null;
  return { text: translateNow(open ? "mailPage.forTaskLine" : "mailPage.completedTaskLine", { title: inlinePlain(task.title) }), done: !open };
}
