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






const input = z.strictObject({
  today: z.iso.date(),
  zone: z.string().min(1).max(64).optional(),
});

export async function POST(request: Request) {
  const body = await readInput(request, input);
  if (!body.ok) return body.response;
  if (!isLivingDay(body.value.today)) return problem(422, "the date sent is not a day anyone is living now: reload the page and ask again");
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
