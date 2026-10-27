import { z } from "zod";

export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  link: z.string().nullable(),
  calendarId: z.string(),
  calendarName: z.string(),
  color: z.string().nullable(),
  accountId: z.string(),
  accountEmail: z.string(),
  fromNodeId: z.string(),
});

export const eventsFailureSchema = z.object({
  accountId: z.string(),
  accountEmail: z.string(),
  reason: z.string(),
});

export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type EventsFailure = z.infer<typeof eventsFailureSchema>;
