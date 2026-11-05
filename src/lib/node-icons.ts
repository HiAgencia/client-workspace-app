export const NODE_ICONS = ["client", "project", "place", "task", "calendar", "mail", "note", "account"] as const;

export type NodeIconName = (typeof NODE_ICONS)[number];

export const NODE_ICON_LABELS: Record<NodeIconName, string> = {
  client: "Client",
  project: "Project",
  place: "Place",
  task: "Task",
  calendar: "Calendar",
  mail: "Mail",
  note: "Note",
  account: "Account",
};

export function isNodeIcon(value: unknown): value is NodeIconName {
  return typeof value === "string" && (NODE_ICONS as readonly string[]).includes(value);
}

export function shownIcon(kind: string | null | undefined, icon: string | null | undefined): NodeIconName {
  if (isNodeIcon(icon)) return icon;
  if (kind === "client") return "client";
  if (kind === "project" || kind === "subproject") return "project";
  return "place";
}
