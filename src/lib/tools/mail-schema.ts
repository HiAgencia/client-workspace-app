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
  
  tasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.enum(["open", "done"]) })),
  nodes: z.array(z.object({ id: z.string(), path: z.string() })),
});

export type MailRow = z.infer<typeof mailRowSchema>;



export const taskMailSchema = z.object({
  
  accountId: z.string().nullable(),
  
  waitsFor: z.string(),
  
  since: z.string(),
  
  dismissed: z.array(z.string()),
});

export type TaskMail = z.infer<typeof taskMailSchema>;
