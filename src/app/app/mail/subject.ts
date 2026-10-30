// What a message without a subject shows in place of one: the same words in every list, in the viewer and in a task's
// detail. The sources give the subject as it came, empty when there was none.
export function subjectOf(message: { subject: string }): string {
  return message.subject.trim() || "(No subject)";
}
