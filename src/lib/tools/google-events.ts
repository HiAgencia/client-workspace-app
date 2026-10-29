import { z } from "zod";
import { withInitialCapital } from "@/lib/initial-capital";
import { GoogleError, type GoogleEvent, type GoogleEventInput } from "@/lib/google/api";
import { isRichHtml, richTextToPlain } from "@/lib/rich-text";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { dbFail, fail, isError, ok, type ToolError } from "./result";
import { loadScope } from "./tree";

// Writing a connected account's Google calendar: create, change, and delete an event. What is written there is Google's;
// the workspace's own events live apart (create_event).

const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });

const target = {
  account: z.uuid().describe("The connected account's id, as list_events or browse_events give it."),
  calendar: z.string().min(1).describe("The calendar's id in that account, such as primary."),
};

const when = {
  startsOn: day.optional().describe("A whole-day event's first day, YYYY-MM-DD."),
  endsOn: day.optional().describe("A whole-day event's last day (included); defaults to its first day."),
  startsAt: instant.optional().describe("A timed event's start, an ISO date-time with its offset."),
  endsAt: instant.optional().describe("A timed event's end; defaults to one hour after its start."),
};

export const googleEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  allDay: z.boolean(),
  link: z.string().nullable(),
  accountId: z.string(),
  calendarId: z.string(),
});

// What Google's description takes: the text as written, or the plain text of the closed list's HTML.
function description(notes: string): string {
  return isRichHtml(notes) ? richTextToPlain(notes) : notes;
}

function shape(event: GoogleEvent, accountId: string, calendarId: string): z.infer<typeof googleEventSchema> {
  const start = event.start?.dateTime ?? event.start?.date ?? null;
  const allDay = !event.start?.dateTime;
  // Google counts a whole day's end as the next day; the screen reads the last day included.
  const rawEnd = event.end?.dateTime ?? event.end?.date ?? null;
  const end = allDay && rawEnd ? new Date(Date.parse(`${rawEnd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : rawEnd;
  return { id: event.id, title: event.summary ?? "(no title)", start, end, allDay, link: event.htmlLink ?? null, accountId, calendarId };
}

function nextDay(value: string): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function moment(input: { startsOn?: string; endsOn?: string; startsAt?: string; endsAt?: string }): Pick<GoogleEventInput, "start" | "end"> | ToolError | null {
  if (input.startsOn && input.startsAt) return fail("invalid_input", "an event is a whole day (startsOn) or timed (startsAt), not both");
  if (input.startsOn) {
    const last = input.endsOn ?? input.startsOn;
    if (last < input.startsOn) return fail("invalid_input", "the last day comes before the first");
    return { start: { date: input.startsOn }, end: { date: nextDay(last) } };
  }
  if (input.startsAt) {
    const start = new Date(input.startsAt);
    const end = input.endsAt ? new Date(input.endsAt) : new Date(start.getTime() + 3_600_000);
    if (end < start) return fail("invalid_input", "the end comes before the start");
    return { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  }
  return null;
}

// The account must be the owner's and, for an access scoped to a node, visible from that node.
async function reachableAccount(ctx: ToolContext, accountId: string): Promise<ToolError | null> {
  if (!ctx.calendar) return fail("not_found", "writing to Google calendars is not configured on this server");
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return loaded;
  const { data, error } = await ctx.db.from("google_accounts").select("id").eq("id", accountId).eq("owner_id", ctx.ownerId).maybeSingle();
  if (error) return dbFail("reading the account", error);
  if (!data) return fail("not_found", `no account with id ${accountId} is reachable here`);
  if (loaded.scope.root) {
    const visible = await ctx.db.rpc("visible_accounts", { node: loaded.scope.root.id });
    if (visible.error) return dbFail("reading the node's accounts", visible.error);
    if (!visible.data.some((row) => row.account_id === accountId)) return fail("not_found", `no account with id ${accountId} is reachable here`);
  }
  return null;
}

function googleFailure(error: unknown): ToolError {
  if (error instanceof GoogleError) {
    if (error.status === 404) return fail("not_found", "Google has no such calendar or event in that account");
    if (error.revoked) return fail("invalid_input", "access was revoked: connect the account again");
    if (error.reason === "read_only") return fail("invalid_input", error.message);
    return fail("internal", `Google did not take the change: ${error.message}`);
  }
  return fail("internal", error instanceof Error ? error.message : "Google did not answer");
}

const output = z.object({ event: googleEventSchema });

export const createGoogleEvent = defineTool({
  name: "create_google_event",
  description:
    "Create an event in a connected Google account's calendar: a whole day with startsOn (and endsOn), or timed with " +
    "startsAt (and endsAt). It shows in Google and here.",
  readOnly: false,
  input: z.strictObject({ ...target, title: z.string().trim().min(1).max(500), notes: z.string().trim().max(8000).optional(), ...when }),
  output,
  async run(ctx, input) {
    const refused = await reachableAccount(ctx, input.account);
    if (refused) return refused;
    const at = moment(input);
    if (!at) return fail("invalid_input", "say when: startsOn for a whole day, or startsAt for a timed event");
    if ("ok" in at) return at;
    try {
      const event = await ctx.calendar!.create({
        ownerId: ctx.ownerId,
        accountId: input.account,
        calendarId: input.calendar,
        event: { summary: withInitialCapital(input.title), ...(input.notes ? { description: description(input.notes) } : {}), ...at },
      });
      return ok({ event: shape(event, input.account, input.calendar) });
    } catch (error) {
      return googleFailure(error);
    }
  },
});

export const updateGoogleEvent = defineTool({
  name: "update_google_event",
  description: "Change an event of a connected Google account: its title, notes, or when. Send only what changes.",
  readOnly: false,
  input: z
    .strictObject({ ...target, event: z.string().min(1).describe("The event's id in Google."), title: z.string().trim().min(1).max(500).optional(), notes: z.string().trim().max(8000).nullable().optional(), ...when })
    .refine((v) => v.title !== undefined || v.notes !== undefined || v.startsOn || v.startsAt, { message: "nothing to change" }),
  output,
  async run(ctx, input) {
    const refused = await reachableAccount(ctx, input.account);
    if (refused) return refused;
    const at = moment(input);
    if (at && "ok" in at) return at;
    const patch: GoogleEventInput = { ...(at ?? {}) };
    if (input.title !== undefined) patch.summary = withInitialCapital(input.title);
    if (input.notes !== undefined) patch.description = input.notes === null ? null : description(input.notes);
    try {
      const event = await ctx.calendar!.update({ ownerId: ctx.ownerId, accountId: input.account, calendarId: input.calendar, eventId: input.event, event: patch });
      return ok({ event: shape(event, input.account, input.calendar) });
    } catch (error) {
      return googleFailure(error);
    }
  },
});

export const deleteGoogleEvent = defineTool({
  name: "delete_google_event",
  description: "Delete an event of a connected Google account. Google keeps it in its own trash; this cannot be undone here.",
  readOnly: false,
  input: z.strictObject({ ...target, event: z.string().min(1).describe("The event's id in Google.") }),
  output: z.object({ deleted: z.object({ id: z.string(), accountId: z.string(), calendarId: z.string() }) }),
  async run(ctx, input) {
    const refused = await reachableAccount(ctx, input.account);
    if (refused) return refused;
    try {
      await ctx.calendar!.remove({ ownerId: ctx.ownerId, accountId: input.account, calendarId: input.calendar, eventId: input.event });
      // A task that lived in it is let go.
      const { error } = await ctx.db.from("item_events").delete().eq("account_id", input.account).eq("google_event_id", input.event);
      if (error) return dbFail("the event was deleted in Google, but letting go of its tasks failed", error);
      return ok({ deleted: { id: input.event, accountId: input.account, calendarId: input.calendar } });
    } catch (error) {
      return googleFailure(error);
    }
  },
});
