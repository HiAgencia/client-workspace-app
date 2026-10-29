import { z } from "zod";
import { mailAddressSchema } from "@/lib/mail/source";

// The shapes the mail tools give and other tools read (a task's row, a search), kept apart from the tools themselves so
// none of them needs another's schema while it loads.

export const mailRowSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  accountId: z.string(),
  accountEmail: z.string(),
  from: mailAddressSchema,
  to: z.array(z.string()),
  subject: z.string(),
  snippet: z.string(),
  receivedAt: z.string(),
  // Unread in Gmail and not opened here.
  unread: z.boolean(),
  opened: z.boolean(),
  important: z.boolean(),
  // The client or project its account hangs from, with its color.
  place: z.object({ nodeId: z.string(), path: z.string(), color: z.string().nullable() }).nullable(),
  // The tasks it is linked to or that wait for it, and the clients and projects it is linked to.
  tasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(["open", "done"]), waits: z.boolean() })),
  nodes: z.array(z.object({ id: z.string(), path: z.string() })),
});

export type MailRow = z.infer<typeof mailRowSchema>;

// What a task waits for and what the daily review wrote about it.
export const taskMailSchema = z.object({
  // waiting: nothing that answers it yet; met: a message did what it waits for; not_met: one arrived and did not.
  status: z.enum(["waiting", "met", "not_met"]),
  sentence: z.string().nullable(),
  // The account it waits in, or null for every account of its place.
  accountId: z.string().nullable(),
  expectFrom: z.string().nullable(),
  // The message that decided the state.
  decidedAccountId: z.string().nullable(),
  decidedMessageId: z.string().nullable(),
  checkedAt: z.string().nullable(),
});

export type TaskMail = z.infer<typeof taskMailSchema>;
