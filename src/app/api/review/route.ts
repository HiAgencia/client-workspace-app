import { type NextRequest } from "next/server";
import { z } from "zod";
import { json, problem } from "@/lib/http";
import { recentReviews, runDailyReview } from "@/lib/review/run";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { isError } from "@/lib/tools/result";
import { validZone } from "@/lib/working-time";

// The day's own review for the signed-in person. Posting runs it once per person and day: a second post the same day
// answers with that run and does nothing again. A review asked for on purpose comes only from the chat, which carries
// the chat's own cap. The day must be one some time zone is living now: the UTC day, the one before, or the one after.
// Reading lists the runs of the last days with what each did, for the activity and its undo.
const input = z.strictObject({
  today: z.iso.date(),
  zone: z.string().min(1).max(64).optional(),
});

const DAY_MS = 86_400_000;

function isLivingDay(day: string, now = Date.now()): boolean {
  const days = [now - DAY_MS, now, now + DAY_MS].map((moment) => new Date(moment).toISOString().slice(0, 10));
  return days.includes(day);
}

export async function POST(request: Request) {
  const body = await readInput(request, input);
  if (!body.ok) return body.response;
  if (!isLivingDay(body.value.today)) return problem(422, "today is not a day any time zone is living now");
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  return toolResponse("daily review", await runDailyReview(session.ctx, { today: body.value.today, zone: validZone(body.value.zone) }));
}

export async function GET(request: NextRequest) {
  const since = request.nextUrl.searchParams.get("since");
  if (since !== null && !z.iso.date().safeParse(since).success) return problem(400, "since is a day, YYYY-MM-DD");
  const session = await sessionContext("manual");
  if (!session) return problem(401, "not signed in");
  const from = since ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const result = await recentReviews(session.ctx, from);
  return isError(result) ? toolResponse("daily reviews", result) : json(result);
}
