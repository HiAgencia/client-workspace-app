import { z } from "zod";

// The fields several tools read the same way. They live apart from the tools so that modules which import one another's
// functions never need one another's schemas while they load.

export const priority = z
  .number()
  .int()
  .min(1)
  .max(4)
  .describe("1 is the most urgent, 4 the least.");

export const dueOn = z.iso.date().describe("A calendar day, YYYY-MM-DD.");

export const dueTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "an hour as HH:MM, 00:00 to 23:59")
  .describe("The hour of the due day on the person's clock, HH:MM; only with a due day.");

export const titleText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .describe("Short and imperative. A link goes over its words: [words](https://address).");
