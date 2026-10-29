import { z } from "zod";
import { reviewOutput, runDailyReview } from "@/lib/review/run";
import { defineTool } from "./define";


export const runDailyReviewTool = defineTool({
  name: "run_daily_review",
  description:
    "Review the person's day now: the overdue tasks, today's, and those waiting for a message, reading the mail that " +
    "arrived for them; it writes each one's mail state and completes those whose message did what they wait for. Use it " +
    "when the person asks to review their day. Every thing it does can be undone from the screen.",
  readOnly: false,
  
  personOnly: true,
  input: z.strictObject({
    today: z.iso.date().describe("The person's calendar day."),
    zone: z.string().min(1).max(64).optional().describe("The person's time zone, an IANA name."),
  }),
  output: reviewOutput,
  run: (ctx, input) => runDailyReview(ctx, { today: input.today, zone: input.zone, requested: true }),
});
