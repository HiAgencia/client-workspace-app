import { type NextRequest } from "next/server";
import { z } from "zod";
import { json, problem } from "@/lib/http";
import { sessionContext } from "@/lib/session-context";
import { eventsForNode } from "@/lib/tools/events";
import { isError } from "@/lib/tools/result";
import { byPriorityThenDue, selectAllItems, toItem } from "@/lib/tools/rows";
import { loadScope } from "@/lib/tools/tree";
import type { CalendarEvent, EventsFailure } from "@/lib/tools/events-source";

// The browser says which calendar day is today and where it starts and ends in its own time zone.
const query = z.object({
  day: z.iso.date(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

// Today across every project: open tasks due today or overdue, and today's events from every account.
export async function GET(request: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return problem(400, "say which day: day, from, and to");
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const { ctx } = session;
  const loaded = await loadScope(ctx);
  if (isError(loaded)) return problem(500, "the workspace could not be read");
  const { scope } = loaded;

  const read = await selectAllItems(
    ctx,
    [...scope.reachable],
    (q) => q.is("deleted_at", null).eq("type", "task").eq("status", "open").lte("due_on", parsed.data.day),
    "reading today's tasks",
  );
  if (isError(read)) {
    console.error(read.message);
    return problem(500, "today's tasks could not be read");
  }
  const tasks = read.rows.map((row) => toItem(row, scope)).sort(byPriorityThenDue);

  // An account hangs from one or more nodes; reading each client root once covers every account, deduplicated.
  const events = new Map<string, CalendarEvent>();
  const failures = new Map<string, EventsFailure>();
  for (const root of [...scope.all.values()].filter((node) => node.parentId === null)) {
    const answer = await eventsForNode(ctx, root, parsed.data.from, parsed.data.to);
    for (const event of answer.events) events.set(`${event.accountId}:${event.calendarId}:${event.id}`, event);
    for (const failure of answer.failures) failures.set(failure.accountId, failure);
  }
  // Accounts attached only below a root are reached from their own nodes.
  const { data: links, error: linksError } = await ctx.db.from("node_accounts").select("node_id");
  if (linksError) {
    console.error("today: reading where accounts hang", linksError.message);
    failures.set("", { accountId: "", accountEmail: "", reason: "some calendars could not be read" });
  }
  for (const nodeId of new Set((links ?? []).map((link) => link.node_id))) {
    const node = scope.all.get(nodeId);
    if (!node || node.parentId === null) continue;
    const answer = await eventsForNode(ctx, node, parsed.data.from, parsed.data.to);
    for (const event of answer.events) events.set(`${event.accountId}:${event.calendarId}:${event.id}`, event);
    for (const failure of answer.failures) failures.set(failure.accountId, failure);
  }

  return json({
    ok: true,
    day: parsed.data.day,
    overdue: tasks.filter((task) => task.dueOn! < parsed.data.day),
    dueToday: tasks.filter((task) => task.dueOn === parsed.data.day),
    events: [...events.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    failures: [...failures.values()],
  });
}
