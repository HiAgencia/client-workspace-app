import { type NextRequest } from "next/server";
import { z } from "zod";
import { json, problem } from "@/lib/http";
import { recentReviews, runDailyReview } from "@/lib/review/run";
import { readInput } from "@/lib/route-input";
import { sessionContext } from "@/lib/session-context";
import { toolResponse } from "@/lib/tool-response";
import { isError } from "@/lib/tools/result";
import { isLivingDay } from "@/lib/living-day";
import { validZone } from "@/lib/working-time";

// The day's own review for the signed-in person. Posting runs it once per person and day: a second post the same day
// answers with that run and does nothing again. A review asked for on purpose is the chat's tool (`run_daily_review`),
// which the chat's route publishes and which neither the screens' tool route nor the MCP dispatches; read by Meta's
// model, it takes a unit of the person's day like this one. The day must be one some time zone is living now.
// Reading lists the runs of the last days with what each did, for the activity and its undo.
const input = z.strictObject({
  today: z.iso.date(),
  zone: z.string().min(1).max(64).optional(),
});

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
