import { z } from "zod";
import { mailAddressSchema } from "@/lib/mail/source";




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
  
  unread: z.boolean(),
  opened: z.boolean(),
  important: z.boolean(),
  
  place: z.object({ nodeId: z.string(), path: z.string(), color: z.string().nullable() }).nullable(),
  
  tasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(["open", "done"]), waits: z.boolean() })),
  nodes: z.array(z.object({ id: z.string(), path: z.string() })),
});

export type MailRow = z.infer<typeof mailRowSchema>;


export const taskMailSchema = z.object({
  
  status: z.enum(["waiting", "met", "not_met"]),
  sentence: z.string().nullable(),
  
  accountId: z.string().nullable(),
  expectFrom: z.string().nullable(),
  
  decidedAccountId: z.string().nullable(),
  decidedMessageId: z.string().nullable(),
  checkedAt: z.string().nullable(),
});

export type TaskMail = z.infer<typeof taskMailSchema>;
