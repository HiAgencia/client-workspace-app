import { z } from "zod";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { calendarEventSchema, eventsFailureSchema, type CalendarEvent, type EventsFailure } from "./events-source";
import { fail, isError, ok, type ToolResult } from "./result";
import { loadScope, resolveNode, type TreeNode } from "./tree";

const DAY_MS = 24 * 60 * 60 * 1000;

export const eventsOutput = z.object({
  node: z.object({ id: z.string(), path: z.string() }),
  from: z.string(),
  to: z.string(),
  events: z.array(calendarEventSchema),
  failures: z.array(eventsFailureSchema),
});

// The events of every account visible from a node: its own and those inherited from its ancestors. One account that
// fails is reported as such and does not hide the others.
export async function eventsForNode(
  ctx: ToolContext,
  node: TreeNode,
  from: string,
  to: string,
): Promise<{ events: CalendarEvent[]; failures: EventsFailure[] }> {
  if (!ctx.events) return { events: [], failures: [] };
  try {
    return await ctx.events({ db: ctx.db, ownerId: ctx.ownerId, nodeId: node.id, from, to });
  } catch (error) {
    // The calendar side failing never takes the node's tasks and decisions down with it.
    const reason = error instanceof Error ? error.message : "the calendars could not be read";
    console.error("events:", reason);
    return { events: [], failures: [{ accountId: "", accountEmail: "", reason: "the calendars could not be read" }] };
  }
}

const instant = z.iso
  .datetime({ offset: true })
  .or(z.iso.date())
  .describe("An ISO date (YYYY-MM-DD) or date-time with its offset.");

export const listEvents = defineTool({
  name: "list_events",
  description:
    "List calendar events of the Google accounts visible from a node (its own and those inherited from the nodes " +
    "above it), between two moments. Defaults: from now to seven days ahead. Each event says which account and " +
    "calendar it comes from; an account that could not be read is listed under failures.",
  readOnly: true,
  input: z.object({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it to use the current node."),
    from: instant.optional(),
    to: instant.optional(),
  }),
  output: eventsOutput,
  async run(ctx, input): Promise<ToolResult<z.infer<typeof eventsOutput>>> {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const resolved = resolveNode(loaded.scope, input.node);
    if (isError(resolved)) return resolved;
    const from = new Date(input.from ?? Date.now());
    // A bare day as the end includes that whole day.
    const to = input.to
      ? new Date(Date.parse(input.to) + (/^\d{4}-\d{2}-\d{2}$/.test(input.to) ? DAY_MS : 0))
      : new Date(from.getTime() + 7 * DAY_MS);
    if (!(to > from)) return fail("invalid_input", "the end must come after the start");
    if (to.getTime() - from.getTime() > 92 * DAY_MS) return fail("invalid_input", "ask for at most three months");
    const { events, failures } = await eventsForNode(ctx, resolved.node, from.toISOString(), to.toISOString());
    return ok({
      node: { id: resolved.node.id, path: resolved.node.path },
      from: from.toISOString(),
      to: to.toISOString(),
      events,
      failures,
    });
  },
});
