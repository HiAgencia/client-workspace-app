import { z } from "zod";
import { isLivingDay } from "@/lib/living-day";
import { reviewOutput, runDailyReview } from "@/lib/review/run";
import { defineTool } from "./define";
import { fail } from "./result";

// The chat's "Review my day": the daily review asked for on purpose, so it runs even when the day's own run already did.
export const runDailyReviewTool = defineTool({
  name: "run_daily_review",
  description:
    "Review the person's day now: the overdue tasks, today's, and those waiting for a message, reading the mail that " +
    "arrived for them; it writes each one's mail state and completes those whose message did what they wait for. Use it " +
    "when the person asks to review their day. Every thing it does can be undone from the screen.",
  readOnly: false,
  // Asked for on purpose, it is the chat's: the screens run the day's own through `POST /api/review`, and an agent's
  // token neither asks for it nor pays for it.
  chatOnly: true,
  input: z.strictObject({
    today: z.iso.date().describe("The person's calendar day."),
    zone: z.string().min(1).max(64).optional().describe("The person's time zone, an IANA name."),
  }),
  output: reviewOutput,
  run: (ctx, input) =>
    isLivingDay(input.today)
      ? runDailyReview(ctx, { today: input.today, zone: input.zone, requested: true })
      : Promise.resolve(fail("invalid_input", "today is not a day any time zone is living now")),
});
