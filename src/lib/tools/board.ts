import { z } from "zod";
import { defineTool } from "./define";
import { fail, isError, ok } from "./result";
import { countInSubtrees, selectAllItems } from "./rows";
import { shownAsRow } from "./tasks";
import { loadScope, reachOf, resolveNode, type TreeNode } from "./tree";

const day = z.iso.date();

const FIGURES = ["open", "late", "dueToday", "dueInRange", "undated"] as const;

const figuresSchema = z.object({
  open: z.number(),
  late: z.number(),
  dueToday: z.number(),
  dueInRange: z.number(),
  undated: z.number(),
});

export const getBoard = defineTool({
  name: "get_board",
  description:
    "The figures of everything in reach, or of one node and everything below it, for the person's calendar day: open " +
    "tasks, late ones, those due today and in a stretch of days (such as this week), and those without a date; and the " +
    "same figures for each node, each counting its whole subtree. Use it to see at once where work is late or piling up.",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it for the current node, or for everything when there is none."),
    today: day.describe("The person's calendar day."),
    from: day.optional().describe("The first day of the stretch to count, such as the week's first day (today when omitted)."),
    through: day.optional().describe("The last day of the stretch, such as the week's last day (the first day when omitted)."),
  }),
  output: z.object({
    scope: z.object({ id: z.string().nullable(), path: z.string() }),
    figures: figuresSchema,
    nodes: z.array(figuresSchema.extend({ id: z.string() })),
  }),
  async run(ctx, input) {
    const from = input.from ?? input.today;
    const through = input.through ?? from;
    if (through < from) return fail("invalid_input", "the stretch ends before it starts");
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let node: TreeNode | null = null;
    if (input.node !== undefined || scope.root) {
      const resolved = resolveNode(scope, input.node);
      if (isError(resolved)) return resolved;
      node = resolved.node;
    }
    const reach = reachOf(scope, node ? { kind: "node", node } : { kind: "all" });
    const read = await selectAllItems(
      ctx,
      reach,
      (query) => query.is("deleted_at", null).eq("status", "open").eq("type", "task"),
      "reading the board",
    );
    if (isError(read)) return read;
    const { total, perNode } = countInSubtrees(read.rows, scope, new Set(reach.nodeIds), FIGURES, (row) => {
      if (!shownAsRow(row)) return [];
      if (row.due_on === null) return ["open", "undated"];
      const counted: Array<(typeof FIGURES)[number]> = ["open"];
      if (row.due_on < input.today) counted.push("late");
      if (row.due_on === input.today) counted.push("dueToday");
      if (row.due_on >= from && row.due_on <= through) counted.push("dueInRange");
      return counted;
    });
    return ok({
      scope: { id: node?.id ?? null, path: node?.path ?? "Everything" },
      figures: total,
      nodes: [...perNode.entries()].map(([id, entry]) => ({ id, ...entry })),
    });
  },
});
