import type { Answer } from "./client-api";





export type LinkedMessage = { id: string; accountId: string; accountEmail: string; from: { name: string | null; email: string }; subject: string; receivedAt: string };
export type MailFailure = { accountId?: string; accountEmail: string; reason: string };
export type LinkedMail = { messages: LinkedMessage[]; mailFailures: MailFailure[] };
export type ItemMail = { messages: LinkedMessage[]; failures: MailFailure[] };

const newestFirst = (a: LinkedMessage, b: LinkedMessage) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0);


export function startRound(shown: LinkedMail | null, first: LinkedMail, toRead: string[]): LinkedMail {
  const pending = new Set(toRead);
  return {
    messages: [...first.messages, ...(shown?.messages ?? []).filter((message) => pending.has(message.accountId))].sort(newestFirst),
    mailFailures: [...first.mailFailures, ...(shown?.mailFailures ?? []).filter((failure) => failure.accountId !== undefined && pending.has(failure.accountId))],
  };
}


export function withAccountMail(shown: LinkedMail, account: { id: string; email: string }, answer: Answer<ItemMail>): LinkedMail {
  const otherFailures = shown.mailFailures.filter((failure) => failure.accountId !== account.id);
  if (!answer.ok) return { ...shown, mailFailures: [...otherFailures, { accountId: account.id, accountEmail: account.email, reason: answer.message }] };
  return {
    messages: [...shown.messages.filter((message) => message.accountId !== account.id), ...answer.messages].sort(newestFirst),
    mailFailures: [...otherFailures, ...answer.failures],
  };
}
