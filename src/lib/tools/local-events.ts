import { z } from "zod";
import { withInitialCapital } from "@/lib/initial-capital";
import type { Database } from "@/lib/db/types";
import { sanitizeRichText } from "@/lib/rich-text";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { origin, reachableItem } from "./items";
import { dbFail, fail, isError, ok, type ToolResult } from "./result";
import { loadScope, reaches, resolveNode, resolveWritePlace, type Reach, type Scope } from "./tree";

// The workspace's own events: they live in the system, not in Google, hang from a node or from none (one created from a
// general task), carry versions like the items, a task can live inside one, and a client or a project links to them.

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type EventUpdate = Database["public"]["Tables"]["events"]["Update"];

export const EVENT_COLUMNS =
  "id, owner_id, node_id, title, body, all_day, starts_on, ends_on, starts_at, ends_at, source, agent_label, changed_source, changed_agent_label, created_at, updated_at, deleted_at";

export const localEventSchema = z.object({
  id: z.string(),
  // The node it lives in, or null for an event of no node.
  nodeId: z.string().nullable(),
  nodePath: z.string().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  allDay: z.boolean(),
  // A whole-day event spans days (the last one included); a timed one spans two instants.
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  source: z.enum(["manual", "chat", "agent", "review"]),
  agentLabel: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

export type LocalEvent = z.infer<typeof localEventSchema>;

export function toLocalEvent(row: EventRow, scope: Scope): LocalEvent {
  return {
    id: row.id,
    nodeId: row.node_id,
    nodePath: row.node_id === null ? null : (scope.all.get(row.node_id)?.path ?? ""),
    title: row.title,
    body: row.body,
    allDay: row.all_day,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    source: row.source,
    agentLabel: row.agent_label,
    deletedAt: row.deleted_at,
  };
}

const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const when = {
  startsOn: day.optional().describe("A whole-day event's first day, YYYY-MM-DD."),
  endsOn: day.optional().describe("A whole-day event's last day (included); defaults to its first day."),
  startsAt: instant.optional().describe("A timed event's start, an ISO date-time with its offset."),
  endsAt: instant.optional().describe("A timed event's end; defaults to one hour after its start."),
};

type When = { startsOn?: string; endsOn?: string; startsAt?: string; endsAt?: string };

// The moment, as the table keeps it: days for a whole day, instants for a timed event, never both.
function moment(input: When): ToolResult<Pick<EventRow, "all_day" | "starts_on" | "ends_on" | "starts_at" | "ends_at">> {
  if (input.startsOn && input.startsAt) return fail("invalid_input", "an event is a whole day (startsOn) or timed (startsAt), not both");
  if (input.startsOn) {
    const endsOn = input.endsOn ?? input.startsOn;
    if (endsOn < input.startsOn) return fail("invalid_input", "the last day comes before the first");
    return ok({ all_day: true, starts_on: input.startsOn, ends_on: endsOn, starts_at: null, ends_at: null });
  }
  if (input.startsAt) {
    const start = new Date(input.startsAt);
    const end = input.endsAt ? new Date(input.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
    if (end < start) return fail("invalid_input", "the end comes before the start");
    return ok({ all_day: false, starts_on: null, ends_on: null, starts_at: start.toISOString(), ends_at: end.toISOString() });
  }
  return fail("invalid_input", "say when: startsOn for a whole day, or startsAt for a timed event");
}

// The columns of a moment, without the result's own mark.
function times(at: { all_day: boolean; starts_on: string | null; ends_on: string | null; starts_at: string | null; ends_at: string | null }) {
  return { all_day: at.all_day, starts_on: at.starts_on, ends_on: at.ends_on, starts_at: at.starts_at, ends_at: at.ends_at };
}

async function reachableEvent(ctx: ToolContext, id: string, withDeleted = false) {
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const { data, error } = await ctx.db.from("events").select(EVENT_COLUMNS).eq("id", id).eq("owner_id", ctx.ownerId).maybeSingle();
  if (error) return dbFail("reading the event", error);
  if (!data || !reaches(loaded.scope, ctx.ownerId, data) || (data.deleted_at && !withDeleted)) {
    return fail("not_found", `no event with id ${id} is reachable here`);
  }
  return ok({ row: data, scope: loaded.scope });
}

const eventOutput = z.object({ event: localEventSchema });

export const createEvent = defineTool({
  name: "create_event",
  description:
    "Create an event of the workspace's own (it lives here, not in Google) in a node, or in no node (node null): a " +
    "whole day with startsOn (and endsOn), or timed with startsAt (and endsAt). Use it for a meeting, a delivery, or a " +
    "milestone.",
  readOnly: false,
  input: z.strictObject({
    node: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("The node's id or path, or null for no node. Omit it to use the current node (no node when there is none)."),
    title: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(20_000).optional(),
    ...when,
  }),
  output: eventOutput,
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const resolved = resolveWritePlace(loaded.scope, input.node);
    if (isError(resolved)) return resolved;
    const at = moment(input);
    if (isError(at)) return at;
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    const { data, error } = await ctx.db
      .from("events")
      .insert({
        owner_id: ctx.ownerId,
        node_id: resolved.node?.id ?? null,
        title: withInitialCapital(input.title),
        body: sanitizeRichText(input.notes),
        ...times(at),
        ...mark,
        changed_source: mark.source,
        changed_agent_label: mark.agent_label,
      })
      .select(EVENT_COLUMNS)
      .single();
    if (error) return dbFail("saving the event", error);
    return ok({ event: toLocalEvent(data, loaded.scope) });
  },
});

export const updateEvent = defineTool({
  name: "update_event",
  description:
    "Change an event of the workspace's own by id: its title, notes, or when (send startsOn for a whole day or " +
    "startsAt for a timed one). Returns the event and its previous values.",
  readOnly: false,
  input: z
    .strictObject({
      id: z.uuid(),
      title: z.string().trim().min(1).max(500).optional(),
      notes: z.string().trim().max(20_000).nullable().optional(),
      ...when,
    })
    .refine((value) => Object.keys(value).some((key) => key !== "id"), { message: "nothing to change" }),
  output: z.object({ event: localEventSchema, previous: localEventSchema }),
  async run(ctx, input) {
    const found = await reachableEvent(ctx, input.id);
    if (isError(found)) return found;
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    const patch: EventUpdate = { changed_source: mark.source, changed_agent_label: mark.agent_label };
    if (input.title !== undefined) patch.title = withInitialCapital(input.title);
    if (input.notes !== undefined) patch.body = sanitizeRichText(input.notes);
    if (input.startsOn || input.startsAt) {
      const at = moment(input);
      if (isError(at)) return at;
      Object.assign(patch, times(at));
    } else if (input.endsOn || input.endsAt) {
      const at = moment(found.row.all_day ? { startsOn: found.row.starts_on!, endsOn: input.endsOn } : { startsAt: found.row.starts_at!, endsAt: input.endsAt });
      if (isError(at)) return at;
      Object.assign(patch, times(at));
    }
    const { data, error } = await ctx.db
      .from("events")
      .update(patch)
      .eq("id", input.id)
      .eq("owner_id", ctx.ownerId)
      .is("deleted_at", null)
      .select(EVENT_COLUMNS)
      .maybeSingle();
    if (error) return dbFail("saving the event", error);
    if (!data) return fail("not_found", `event ${input.id} was deleted meanwhile`);
    return ok({ event: toLocalEvent(data, found.scope), previous: toLocalEvent(found.row, found.scope) });
  },
});

export const deleteEvent = defineTool({
  name: "delete_event",
  description: "Delete an event of the workspace's own by id. It can be undone, so it does not need confirmation.",
  readOnly: false,
  input: z.strictObject({ id: z.uuid() }),
  output: eventOutput,
  async run(ctx, input) {
    const found = await reachableEvent(ctx, input.id, true);
    if (isError(found)) return found;
    if (found.row.deleted_at) return ok({ event: toLocalEvent(found.row, found.scope) });
    const mark = origin(ctx);
    if (!mark) return fail("internal", "an agent write needs its token's label");
    const { data, error } = await ctx.db
      .from("events")
      .update({ deleted_at: new Date().toISOString(), changed_source: mark.source, changed_agent_label: mark.agent_label })
      .eq("id", input.id)
      .eq("owner_id", ctx.ownerId)
      .select(EVENT_COLUMNS)
      .single();
    if (error) return dbFail("deleting the event", error);
    return ok({ event: toLocalEvent(data, found.scope) });
  },
});

// Undo of an event's deletion; not offered to models, like the items' restore.
export async function restoreEvent(ctx: ToolContext, id: string): Promise<ToolResult<z.infer<typeof eventOutput>>> {
  const found = await reachableEvent(ctx, id, true);
  if (isError(found)) return found;
  if (!found.row.deleted_at) return ok({ event: toLocalEvent(found.row, found.scope) });
  const mark = origin(ctx);
  if (!mark) return fail("internal", "an agent write needs its token's label");
  const { data, error } = await ctx.db
    .from("events")
    .update({ deleted_at: null, changed_source: mark.source, changed_agent_label: mark.agent_label })
    .eq("id", id)
    .eq("owner_id", ctx.ownerId)
    .select(EVENT_COLUMNS)
    .single();
  if (error) return dbFail("restoring the event", error);
  return ok({ event: toLocalEvent(data, found.scope) });
}

// The local events of a reach that touch a range of days, read in one query: those of its nodes, those of no node when it
// reaches General, and those linked to its nodes (`linked`, the ids `node_events` gives).
export async function localEventsIn(
  ctx: ToolContext,
  scope: Scope,
  reach: Reach,
  fromDay: string,
  toDay: string,
  range: { from: string; to: string },
  linked: string[] = [],
): Promise<ToolResult<{ events: LocalEvent[] }>> {
  const places = [
    ...(reach.nodeIds.length > 0 ? [`node_id.in.(${reach.nodeIds.join(",")})`] : []),
    ...(reach.general ? ["node_id.is.null"] : []),
    ...(linked.length > 0 ? [`id.in.(${linked.join(",")})`] : []),
  ];
  if (places.length === 0) return ok({ events: [] });
  const { data, error } = await ctx.db
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("owner_id", ctx.ownerId)
    .is("deleted_at", null)
    // One filter: where it is, and when. A second `or` on the same query would not combine with the first.
    .or(
      `and(or(${places.join(",")}),or(and(all_day.eq.true,starts_on.lte.${toDay},ends_on.gte.${fromDay}),and(all_day.eq.false,starts_at.lt.${range.to},ends_at.gt.${range.from})))`,
    )
    .limit(1000);
  if (error) return dbFail("reading the events", error);
  // A linked event of a node outside the reach still shows where it is linked; its own place is said only when reached.
  return ok({ events: data.filter((row) => reaches(scope, ctx.ownerId, row) || linked.includes(row.id)).map((row) => toLocalEvent(row, scope)) });
}

// A task inside an event ------------------------------------------------------------------------------------------

export const taskEventSchema = z.object({
  itemId: z.string(),
  eventId: z.string().nullable(),
  accountId: z.string().nullable(),
  calendarId: z.string().nullable(),
  googleEventId: z.string().nullable(),
});

export const linkTaskEvent = defineTool({
  name: "link_task_event",
  description:
    "Put a task inside an event: an event of the workspace's own (event), or a Google event (account, calendar, " +
    "googleEvent as list_events gives them). A task lives in one event; linking it again moves it.",
  readOnly: false,
  input: z
    .strictObject({
      task: z.uuid().describe("The task's id."),
      event: z.uuid().optional().describe("The id of an event of the workspace's own."),
      account: z.uuid().optional(),
      calendar: z.string().min(1).optional(),
      googleEvent: z.string().min(1).optional(),
    })
    .refine((v) => (v.event ? !v.account && !v.calendar && !v.googleEvent : Boolean(v.account && v.calendar && v.googleEvent)), {
      message: "give either event, or account with calendar and googleEvent",
    }),
  // The task's title, for the card that says what was linked.
  output: z.object({ link: taskEventSchema, title: z.string() }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.task);
    if (isError(found)) return fail("not_found", `no task with id ${input.task} is reachable here`);
    if (found.row.type !== "task") return fail("invalid_input", `a ${found.row.type} does not live in an event: only a task does`);
    const target = await reachableTarget(ctx, input);
    if (target) return target;
    // A task lives in one event: linking it again replaces its link in one write, so it is never left without one.
    const row = {
      item_id: input.task,
      event_id: input.event ?? null,
      account_id: input.event ? null : input.account!,
      calendar_id: input.event ? null : input.calendar!,
      google_event_id: input.event ? null : input.googleEvent!,
    };
    const { error } = await ctx.db.from("item_events").upsert(row, { onConflict: "item_id" });
    if (error) return dbFail("putting the task in the event", error);
    return ok({
      link: { itemId: row.item_id, eventId: row.event_id, accountId: row.account_id, calendarId: row.calendar_id, googleEventId: row.google_event_id },
      title: found.row.title,
    });
  },
});

export const unlinkTaskEvent = defineTool({
  name: "unlink_task_event",
  description: "Take a task out of the event it lives in.",
  readOnly: false,
  input: z.strictObject({ task: z.uuid() }),
  // The link it took away, so whoever undoes it can put the task back in that same event.
  output: z.object({ task: z.string(), title: z.string(), removed: z.boolean(), link: taskEventSchema.nullable() }),
  async run(ctx, input) {
    const found = await reachableItem(ctx, input.task, true);
    if (isError(found)) return fail("not_found", `no task with id ${input.task} is reachable here`);
    const { data, error } = await ctx.db
      .from("item_events")
      .delete()
      .eq("item_id", input.task)
      .select("item_id, event_id, account_id, calendar_id, google_event_id");
    if (error) return dbFail("taking the task out", error);
    const row = data[0];
    const link = row
      ? { itemId: row.item_id, eventId: row.event_id, accountId: row.account_id, calendarId: row.calendar_id, googleEventId: row.google_event_id }
      : null;
    return ok({ task: input.task, title: found.row.title, removed: data.length > 0, link });
  },
});

// The event a link names: one of the workspace's own the caller reaches, or one of a connected account of the owner.
async function reachableTarget(ctx: ToolContext, input: { event?: string; account?: string }) {
  if (input.event) {
    const event = await reachableEvent(ctx, input.event);
    return isError(event) ? event : null;
  }
  const { data: account, error } = await ctx.db.from("google_accounts").select("id").eq("id", input.account!).eq("owner_id", ctx.ownerId).maybeSingle();
  if (error) return dbFail("reading the account", error);
  return account ? null : fail("not_found", `no account with id ${input.account} is reachable here`);
}

// A client or a project linked to an event ----------------------------------------------------------------------------

export const nodeEventSchema = z.object({
  nodeId: z.string(),
  eventId: z.string().nullable(),
  accountId: z.string().nullable(),
  calendarId: z.string().nullable(),
  googleEventId: z.string().nullable(),
});

const eventTarget = {
  event: z.uuid().optional().describe("The id of an event of the workspace's own."),
  account: z.uuid().optional(),
  calendar: z.string().min(1).optional(),
  googleEvent: z.string().min(1).optional(),
};

const oneTarget = (v: { event?: string; account?: string; calendar?: string; googleEvent?: string }) =>
  v.event ? !v.account && !v.calendar && !v.googleEvent : Boolean(v.account && v.calendar && v.googleEvent);

export const linkNodeEvent = defineTool({
  name: "link_node_event",
  description:
    "Link a client or a project to an event: one of the workspace's own (event), or a Google event (account, calendar, " +
    "googleEvent as browse_events gives them). A node links to many events and an event to many nodes; linking twice " +
    "changes nothing.",
  readOnly: false,
  input: z
    .strictObject({ node: z.string().min(1).describe("The node's id or path."), ...eventTarget })
    .refine(oneTarget, { message: "give either event, or account with calendar and googleEvent" }),
  output: z.object({ link: nodeEventSchema, created: z.boolean() }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const resolved = resolveNode(loaded.scope, input.node);
    if (isError(resolved)) return resolved;
    const target = await reachableTarget(ctx, input);
    if (target) return target;
    const row = {
      node_id: resolved.node.id,
      event_id: input.event ?? null,
      account_id: input.event ? null : input.account!,
      calendar_id: input.event ? null : input.calendar!,
      google_event_id: input.event ? null : input.googleEvent!,
    };
    const link = { nodeId: row.node_id, eventId: row.event_id, accountId: row.account_id, calendarId: row.calendar_id, googleEventId: row.google_event_id };
    const { error } = await ctx.db.from("node_events").insert(row);
    // The pair already linked is the same outcome.
    if (error?.code === "23505") return ok({ link, created: false });
    if (error) return dbFail("linking the node to the event", error);
    return ok({ link, created: true });
  },
});

export const unlinkNodeEvent = defineTool({
  name: "unlink_node_event",
  description: "Take a client or a project off an event it is linked to.",
  readOnly: false,
  input: z
    .strictObject({ node: z.string().min(1).describe("The node's id or path."), ...eventTarget })
    .refine(oneTarget, { message: "give either event, or account with calendar and googleEvent" }),
  output: z.object({ node: z.string(), removed: z.boolean() }),
  async run(ctx, input) {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const resolved = resolveNode(loaded.scope, input.node);
    if (isError(resolved)) return resolved;
    let query = ctx.db.from("node_events").delete().eq("node_id", resolved.node.id);
    query = input.event
      ? query.eq("event_id", input.event)
      : query.eq("account_id", input.account!).eq("calendar_id", input.calendar!).eq("google_event_id", input.googleEvent!);
    const { data, error } = await query.select("id");
    if (error) return dbFail("taking the node off the event", error);
    return ok({ node: resolved.node.id, removed: data.length > 0 });
  },
});

// The links of some nodes, as rows: which events each node is linked to.
export async function nodeEventLinks(ctx: ToolContext, nodeIds: string[]) {
  if (nodeIds.length === 0) return ok({ links: [] as Array<z.infer<typeof nodeEventSchema>> });
  const { data, error } = await ctx.db
    .from("node_events")
    .select("node_id, event_id, account_id, calendar_id, google_event_id")
    .in("node_id", nodeIds)
    .limit(1000);
  if (error) return dbFail("reading the events linked to the nodes", error);
  return ok({
    links: data.map((row) => ({
      nodeId: row.node_id,
      eventId: row.event_id,
      accountId: row.account_id,
      calendarId: row.calendar_id,
      googleEventId: row.google_event_id,
    })),
  });
}

// The links of some tasks and of some events, both ways: which event each task lives in, and which tasks each event
// holds.
export async function taskEventLinks(ctx: ToolContext, filter: { itemIds?: string[]; eventIds?: string[] }) {
  let query = ctx.db.from("item_events").select("item_id, event_id, account_id, calendar_id, google_event_id");
  if (filter.itemIds) query = query.in("item_id", filter.itemIds);
  if (filter.eventIds) query = query.in("event_id", filter.eventIds);
  const { data, error } = await query.limit(1000);
  if (error) return dbFail("reading what lives in the events", error);
  return ok({
    links: data.map((row) => ({
      itemId: row.item_id,
      eventId: row.event_id,
      accountId: row.account_id,
      calendarId: row.calendar_id,
      googleEventId: row.google_event_id,
    })),
  });
}
