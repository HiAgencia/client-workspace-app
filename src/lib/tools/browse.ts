import { z } from "zod";
import { richTextToPlain } from "@/lib/rich-text";
import { defineTool } from "./define";
import { eventsForNode } from "./events";
import { calendarEventSchema, eventsFailureSchema, type CalendarEvent, type EventsFailure } from "./events-source";
import { localEventsIn, type LocalEvent } from "./local-events";
import { fail, isError, ok } from "./result";
import { byPriorityThenDue, itemSchema, itemTypes, newestFirst, selectAllItems, toItem, type Item } from "./rows";
import { loadScope, resolveNode, subtree, type Scope, type TreeNode } from "./tree";

// The reading the central panel, Today, the calendar, the chat, and the MCP share: items by node and subtree with every
// filter and its count, and the events of a range from the Google accounts and the workspace's own, deduplicated.

const sources = ["manual", "chat", "agent"] as const;
const day = z.iso.date();

const facetCounts = z.object({
  type: z.record(z.string(), z.number()),
  status: z.record(z.string(), z.number()),
  priority: z.record(z.string(), z.number()),
  source: z.record(z.string(), z.number()),
  date: z.object({ overdue: z.number(), dated: z.number(), undated: z.number() }),
});

export type Facets = z.infer<typeof facetCounts>;

type Filters = {
  type?: (typeof itemTypes)[number][];
  status: "open" | "done" | "all";
  priority?: number[];
  source?: (typeof sources)[number][];
  text?: string;
  from?: string;
  to?: string;
  undated?: boolean;
  parent?: string;
  today?: string;
};

type Facet = "type" | "status" | "priority" | "source" | "date";

// Whether an item passes the filters, leaving one facet out: a facet's counts are what its other filters let through,
// so each count says what choosing that value would show.
function passes(item: Item, filters: Filters, plain: string, skip?: Facet): boolean {
  if (skip !== "type" && filters.type && !filters.type.includes(item.type)) return false;
  if (skip !== "status" && filters.status !== "all" && item.status !== filters.status) return false;
  if (skip !== "priority" && filters.priority && !(item.type === "task" && filters.priority.includes(item.priority ?? 4))) return false;
  if (skip !== "source" && filters.source && !filters.source.includes(item.source)) return false;
  if (skip !== "date") {
    if (filters.undated && item.dueOn !== null) return false;
    // A range reads due dates; an item without one is outside every range (it does not fall due), and is only in "all".
    if ((filters.from || filters.to) && item.dueOn === null) return false;
    if (filters.from && item.dueOn! < filters.from) return false;
    if (filters.to && item.dueOn! > filters.to) return false;
  }
  if (filters.parent && item.parentId !== filters.parent) return false;
  if (filters.text && !plain.includes(filters.text)) return false;
  return true;
}

export function browseInMemory(items: Item[], filters: Filters) {
  const text = filters.text?.toLowerCase();
  const prepared = items.map((item) => ({ item, plain: text ? `${item.title}\n${richTextToPlain(item.body)}`.toLowerCase() : "" }));
  const narrowed = { ...filters, text };
  const counts: Facets = { type: {}, status: {}, priority: {}, source: {}, date: { overdue: 0, dated: 0, undated: 0 } };
  const bump = (record: Record<string, number>, key: string) => (record[key] = (record[key] ?? 0) + 1);
  for (const { item, plain } of prepared) {
    if (passes(item, narrowed, plain, "type")) bump(counts.type, item.type);
    if (passes(item, narrowed, plain, "status") && item.type !== "note") bump(counts.status, item.status);
    if (passes(item, narrowed, plain, "priority") && item.type === "task") bump(counts.priority, String(item.priority ?? 4));
    if (passes(item, narrowed, plain, "source")) bump(counts.source, item.source);
    if (passes(item, narrowed, plain, "date")) {
      if (item.dueOn === null) counts.date.undated++;
      else {
        counts.date.dated++;
        if (filters.today && item.dueOn < filters.today && item.status === "open") counts.date.overdue++;
      }
    }
  }
  const matched = prepared.filter(({ item, plain }) => passes(item, narrowed, plain)).map(({ item }) => item);
  return { matched, counts };
}

function scopeNodes(scope: Scope, node: TreeNode | null, withSubtree: boolean): string[] {
  if (!node) return [...scope.reachable];
  if (!withSubtree) return [node.id];
  return [...subtree(scope.all, node.id)].filter((id) => scope.reachable.has(id));
}

export const browseItems = defineTool({
  name: "browse_items",
  description:
    "Browse items with filters, in one node and everything below it (or everything reachable): type, status, " +
    "priority, origin (manual, chat, agent), text, a range of due dates (from, to), only undated, or what hangs from " +
    "a task (parent). Returns the matches in order (tasks by priority then date, the rest newest first; or by due " +
    "date, or newest) and, for each filter, how many each value would show. An item without a due date never falls " +
    "due: it is outside every date range.",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it for the current node, or for everything when there is none."),
    subtree: z.boolean().default(true).describe("Include every node below (default) or only the node itself."),
    type: z.array(z.enum(itemTypes)).min(1).optional(),
    status: z.enum(["open", "done", "all"]).default("open"),
    priority: z.array(z.number().int().min(1).max(4)).min(1).optional(),
    source: z.array(z.enum(sources)).min(1).optional(),
    text: z.string().trim().min(1).max(200).optional(),
    from: day.optional().describe("Due on or after this day."),
    to: day.optional().describe("Due on or before this day."),
    undated: z.boolean().optional().describe("Only items without a due date."),
    parent: z.uuid().optional(),
    today: day.optional().describe("The person's calendar day, to count what is overdue."),
    sort: z.enum(["priority", "due", "newest"]).default("priority"),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: z.object({
    scope: z.object({ id: z.string().nullable(), path: z.string() }),
    items: z.array(itemSchema),
    total: z.number(),
    counts: facetCounts,
  }),
  async run(ctx, input) {
    if (input.undated && (input.from || input.to)) return fail("invalid_input", "undated items have no date to fall in a range");
    if (input.from && input.to && input.to < input.from) return fail("invalid_input", "the range ends before it starts");
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let node: TreeNode | null = null;
    if (input.node !== undefined || scope.root) {
      const resolved = resolveNode(scope, input.node);
      if (isError(resolved)) return resolved;
      node = resolved.node;
    }
    const read = await selectAllItems(ctx, scopeNodes(scope, node, input.subtree), (query) => query.is("deleted_at", null), "browsing the items");
    if (isError(read)) return read;
    const { matched, counts } = browseInMemory(
      read.rows.map((row) => toItem(row, scope)),
      input,
    );
    const ordered =
      input.sort === "newest"
        ? matched.sort(newestFirst)
        : input.sort === "due"
          ? matched.sort((a, b) => (a.dueOn ?? "9999") < (b.dueOn ?? "9999") ? -1 : (a.dueOn ?? "9999") > (b.dueOn ?? "9999") ? 1 : byPriorityThenDue(a, b))
          : [...matched.filter((i) => i.type === "task").sort(byPriorityThenDue), ...matched.filter((i) => i.type !== "task").sort(newestFirst)];
    return ok({
      scope: { id: node?.id ?? null, path: node?.path ?? "Everything" },
      items: ordered.slice(0, input.limit),
      total: ordered.length,
      counts,
    });
  },
});

// An event of either origin, in the one shape the screens and the models read.
export const browsedEventSchema = calendarEventSchema.extend({
  origin: z.enum(["google", "local"]),
  // For an event of the workspace's own: its id and the node it hangs from.
  localId: z.string().nullable(),
  nodeId: z.string().nullable(),
  nodePath: z.string().nullable(),
});

export type BrowsedEvent = z.infer<typeof browsedEventSchema>;

function fromGoogle(event: CalendarEvent): BrowsedEvent {
  return { ...event, origin: "google", localId: null, nodeId: null, nodePath: null };
}

export function fromLocal(event: LocalEvent): BrowsedEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.allDay ? event.startsOn! : event.startsAt!,
    end: event.allDay ? event.endsOn! : event.endsAt!,
    allDay: event.allDay,
    location: null,
    link: null,
    calendarId: "workspace",
    calendarName: event.nodePath,
    color: null,
    accountId: "",
    accountEmail: "",
    fromNodeId: event.nodeId,
    origin: "local",
    localId: event.id,
    nodeId: event.nodeId,
    nodePath: event.nodePath,
  };
}

const startOf = (event: BrowsedEvent) => (event.allDay ? Date.parse(`${event.start}T00:00:00`) : Date.parse(event.start));

export const browseEvents = defineTool({
  name: "browse_events",
  description:
    "The events between two moments: those of the Google accounts visible from a node (its own and inherited) and " +
    "the workspace's own events of that node and everything below it; without a node, every account and every own " +
    "event, each event once. Each says its origin (google or local).",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it for the current node, or for everything."),
    from: z.iso.datetime({ offset: true }).describe("The range's start, an ISO date-time with its offset."),
    to: z.iso.datetime({ offset: true }).describe("The range's end."),
    fromDay: day.describe("The person's calendar day where the range starts, for whole-day events."),
    toDay: day.describe("The person's last calendar day in the range (included)."),
  }),
  output: z.object({ events: z.array(browsedEventSchema), failures: z.array(eventsFailureSchema) }),
  async run(ctx, input) {
    if (!(Date.parse(input.to) > Date.parse(input.from))) return fail("invalid_input", "the end must come after the start");
    if (Date.parse(input.to) - Date.parse(input.from) > 93 * 24 * 60 * 60 * 1000) return fail("invalid_input", "ask for at most three months");
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    let node: TreeNode | null = null;
    if (input.node !== undefined || scope.root) {
      const resolved = resolveNode(scope, input.node);
      if (isError(resolved)) return resolved;
      node = resolved.node;
    }
    // A node reads its visible accounts; everything reads each client root and each node an account hangs from below a
    // root, once each, in parallel. The workspace's own events come in the same round.
    let anchors: TreeNode[] = node ? [node] : [...scope.all.values()].filter((n) => n.parentId === null && scope.reachable.has(n.id));
    if (!node && ctx.events) {
      const { data: links, error } = await ctx.db.from("node_accounts").select("node_id");
      if (error) console.error("events: reading where accounts hang", error.message);
      const below = new Set((links ?? []).map((link) => link.node_id));
      anchors = [...anchors, ...[...below].map((id) => scope.all.get(id)).filter((n): n is TreeNode => Boolean(n && n.parentId !== null))];
    }
    const [google, local] = await Promise.all([
      Promise.all(anchors.map((anchor) => eventsForNode(ctx, anchor, input.from, input.to))),
      localEventsIn(ctx, scope, scopeNodes(scope, node, true), input.fromDay, input.toDay, { from: input.from, to: input.to }),
    ]);
    if (isError(local)) return local;
    const events = new Map<string, BrowsedEvent>();
    const failures = new Map<string, EventsFailure>();
    for (const answer of google) {
      for (const event of answer.events) events.set(`g:${event.accountId}:${event.calendarId}:${event.id}`, fromGoogle(event));
      for (const failure of answer.failures) failures.set(failure.accountId, failure);
    }
    for (const event of local.events) events.set(`l:${event.id}`, fromLocal(event));
    return ok({ events: [...events.values()].sort((a, b) => startOf(a) - startOf(b)), failures: [...failures.values()] });
  },
});
