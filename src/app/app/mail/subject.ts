

export function subjectOf(message: { subject: string }): string {
  return message.subject.trim() || "(No subject)";
}
