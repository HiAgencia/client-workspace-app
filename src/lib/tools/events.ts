import { z } from "zod";
import type { ToolContext } from "./context";
import { defineTool } from "./define";
import { calendarEventSchema, eventsFailureSchema, type CalendarEvent, type EventsFailure } from "./events-source";
import { localEventsIn, type LocalEvent } from "./local-events";
import { accountsOf } from "./mail";
import { fail, isError, ok, type ToolResult } from "./result";
import { loadScope, reachOf, resolveNode, type ReadPlace, type Scope } from "./tree";

const DAY_MS = 24 * 60 * 60 * 1000;


export const browsedEventSchema = calendarEventSchema.extend({
  origin: z.enum(["google", "local"]),
  
  localId: z.string().nullable(),
  nodeId: z.string().nullable(),
  nodePath: z.string().nullable(),
  
  linkedNodeIds: z.array(z.string()),
  linkedTaskIds: z.array(z.string()),
});

export type BrowsedEvent = z.infer<typeof browsedEventSchema>;

export function fromGoogle(event: CalendarEvent): BrowsedEvent {
  return { ...event, origin: "google", localId: null, nodeId: null, nodePath: null, linkedNodeIds: [], linkedTaskIds: [] };
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
    calendarName: event.nodePath ?? "Workspace",
    color: null,
    accountId: "",
    accountEmail: "",
    fromNodeId: event.nodeId ?? "",
    origin: "local",
    localId: event.id,
    nodeId: event.nodeId,
    nodePath: event.nodePath,
    linkedNodeIds: [],
    linkedTaskIds: [],
  };
}

const startOf = (event: BrowsedEvent) => (event.allDay ? Date.parse(`${event.start}T00:00:00`) : Date.parse(event.start));

export const inTimeOrder = (events: BrowsedEvent[]) => events.sort((a, b) => startOf(a) - startOf(b));



export const daysOfRange = (from: Date, to: Date) => ({ fromDay: new Date(from.getTime() - 14 * 3_600_000).toISOString().slice(0, 10), toDay: to.toISOString().slice(0, 10) });

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const AT_MIDNIGHT = /T00:00(:00(\.0+)?)?(Z|[+-])/;
const daysAfter = (day: string, days: number) => new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);




function daysAsked(asked: { from?: string; to?: string }, from: Date, to: Date) {
  const margin = daysOfRange(from, to);
  const startsADay = asked.from !== undefined && (BARE_DAY.test(asked.from) || AT_MIDNIGHT.test(asked.from));
  const lastDay = () => {
    if (asked.to) return BARE_DAY.test(asked.to) ? asked.to : daysAfter(asked.to.slice(0, 10), AT_MIDNIGHT.test(asked.to) ? -1 : 0);
    return asked.from ? daysAfter(asked.from.slice(0, 10), startsADay ? 6 : 7) : margin.toDay;
  };
  return { fromDay: asked.from ? asked.from.slice(0, 10) : margin.fromDay, toDay: lastDay() };
}


export const accountRowSchema = z.object({ id: z.string(), email: z.string(), isDemo: z.boolean(), status: z.string(), nodeId: z.string().nullable() });

type AccountRow = z.infer<typeof accountRowSchema>;

export type CalendarsRead = { accounts: AccountRow[]; toRead: string[]; events: CalendarEvent[]; failures: EventsFailure[] };







export async function readCalendars(ctx: ToolContext, scope: Scope, place: ReadPlace, range: { from: string; to: string }, account?: string): Promise<ToolResult<CalendarsRead>> {
  const reached = await accountsOf(ctx, scope, place);
  if (isError(reached)) {
    if (account) return reached;
    return ok({ accounts: [], toRead: [], events: [], failures: [{ accountId: "", accountEmail: "", reason: "the calendars could not be read" }] });
  }
  const accounts = reached.accounts.flatMap(({ id, email, isDemo, status, nodeId }) => (nodeId ? [{ id, email, isDemo, status, nodeId }] : []));
  if (account && !accounts.some((entry) => entry.id === account)) return fail("not_found", `no account with id ${account} is reachable here`);
  const asked = account ? accounts.filter((entry) => entry.id === account) : accounts;
  const said = { accounts: asked.map((entry) => ({ ...entry, nodeId: scope.reachable.has(entry.nodeId) ? entry.nodeId : null })) };
  const source = ctx.events;
  if (!source) return ok({ ...said, toRead: [], events: [], failures: [] });
  const connected = accounts.filter((entry) => !entry.isDemo);
  const toRead = !account && (connected.length > 1 || ctx.source === "chat") ? connected.map((entry) => entry.id) : [];
  const read = account ? asked : accounts.filter((entry) => entry.isDemo || toRead.length === 0);
  const answers = await Promise.all(
    read.map(async (entry) => {
      try {
        return await source({ db: ctx.db, ownerId: ctx.ownerId, account: entry, nodeId: entry.nodeId, from: range.from, to: range.to });
      } catch (error) {
        
        console.error(`events of account ${entry.id}:`, error instanceof Error ? error.message : error);
        return { events: [], failures: [{ accountId: entry.id, accountEmail: entry.email, reason: "the calendars could not be read" }] };
      }
    }),
  );
  const events = answers.flatMap((answer) => answer.events).map((event) => (scope.reachable.has(event.fromNodeId) ? event : { ...event, fromNodeId: "" }));
  return ok({ ...said, toRead, events, failures: answers.flatMap((answer) => answer.failures) });
}

const instant = z.iso
  .datetime({ offset: true })
  .or(z.iso.date())
  .describe("An ISO date (YYYY-MM-DD) or date-time with its offset.");

export const eventsOutput = z.object({
  node: z.object({ id: z.string(), path: z.string() }),
  from: z.string(),
  to: z.string(),
  accounts: z.array(accountRowSchema),
  
  toRead: z.array(z.string()),
  events: z.array(browsedEventSchema),
  failures: z.array(eventsFailureSchema),
});

export const listEvents = defineTool({
  name: "list_events",
  description:
    "List a node's calendar events between two moments, one account per call. With account: only that account's events; " +
    "not_found when the node does not see it (it sees its own accounts and those inherited from the nodes above). Without " +
    "it: the workspace's own events of the node and below it, the sample accounts', and a lone connected account's; over " +
    "several connected accounts it reads none of them. A connected account it did not read is listed in toRead, and each is " +
    "read with its own call. Days without an hour as from and to bring the workspace's whole-day events of exactly those " +
    "days, and a moment counts as the day written in its own offset. Defaults: from now to seven days ahead, its whole-day " +
    "events starting half a day back in UTC. Each event says its origin (google or local), account and calendar; an account " +
    "that could not be read is listed under failures.",
  readOnly: true,
  input: z.strictObject({
    node: z.string().min(1).optional().describe("The node's id or path. Omit it to use the current node."),
    account: z.uuid().optional().describe("The account to read. Omit it to learn the node's accounts: one alone is read at once."),
    from: instant.optional(),
    to: instant.optional(),
  }),
  output: eventsOutput,
  async run(ctx, input): Promise<ToolResult<z.infer<typeof eventsOutput>>> {
    const loaded = await loadScope(ctx);
    if (isError(loaded)) return loaded;
    const { scope } = loaded;
    const resolved = resolveNode(scope, input.node);
    if (isError(resolved)) return resolved;
    const from = new Date(input.from ?? Date.now());
    
    const to = input.to
      ? new Date(Date.parse(input.to) + (BARE_DAY.test(input.to) ? DAY_MS : 0))
      : new Date(from.getTime() + 7 * DAY_MS);
    if (!(to > from)) return fail("invalid_input", "the end must come after the start");
    if (to.getTime() - from.getTime() > 92 * DAY_MS) return fail("invalid_input", "ask for at most three months");
    const range = { from: from.toISOString(), to: to.toISOString() };
    const place: ReadPlace = { kind: "node", node: resolved.node };
    const { fromDay, toDay } = daysAsked(input, from, to);
    const [google, local] = await Promise.all([
      readCalendars(ctx, scope, place, range, input.account),
      input.account ? ok({ events: [] as LocalEvent[] }) : localEventsIn(ctx, scope, reachOf(scope, place), fromDay, toDay, range),
    ]);
    if (isError(google)) return google;
    if (isError(local)) return local;
    return ok({
      node: { id: resolved.node.id, path: resolved.node.path },
      ...range,
      accounts: google.accounts,
      toRead: google.toRead,
      events: inTimeOrder([...google.events.map(fromGoogle), ...local.events.map(fromLocal)]),
      failures: google.failures,
    });
  },
});
