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
  // The tasks and the clients and projects it is linked to.
  tasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(["open", "done"]) })),
  nodes: z.array(z.object({ id: z.string(), path: z.string() })),
});

export type MailRow = z.infer<typeof mailRowSchema>;

// What a task waits for. The app looks for its possible replies and the person decides which one answers it: nothing marks
// the task done on its own.
export const taskMailSchema = z.object({
  // The account it waits in, or null for every account of its place.
  accountId: z.string().nullable(),
  // In the person's words: every word is looked for in the sender's name or address and in the subject of what arrives.
  waitsFor: z.string(),
  // Since when it waits: what arrived before is no reply.
  since: z.string(),
  // The possible replies the person ruled out, each as `<account id>:<message id>`.
  dismissed: z.array(z.string()),
});

export type TaskMail = z.infer<typeof taskMailSchema>;
