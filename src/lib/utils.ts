// Joins class names, dropping the empty ones. Components use the system's semantic classes (styles/system.css), so
// there are no utility conflicts to merge.
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
