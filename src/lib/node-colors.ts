// The colors a person may give a client or a project: role names the theme paints, never values, so a theme changes them in
// one place. The database holds the same list in `nodes_color_palette` (20261031030000), and a test compares both.
export const NODE_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink", "gray"] as const;

export type NodeColor = (typeof NODE_COLORS)[number];

export function isNodeColor(value: unknown): value is NodeColor {
  return typeof value === "string" && (NODE_COLORS as readonly string[]).includes(value);
}
