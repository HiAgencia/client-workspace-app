export const NODE_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink", "gray"] as const;

export type NodeColor = (typeof NODE_COLORS)[number];

export function isNodeColor(value: unknown): value is NodeColor {
  return typeof value === "string" && (NODE_COLORS as readonly string[]).includes(value);
}
