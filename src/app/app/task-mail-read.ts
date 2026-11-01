import type { Answer } from "./client-api";





export type LinkedMessage = { id: string; accountId: string; accountEmail: string; from: { name: string | null; email: string }; subject: string; receivedAt: string };
export type MailFailure = { accountId?: string; accountEmail: string; reason: string };
export type LinkedMail = { messages: LinkedMessage[]; mailFailures: MailFailure[] };
export type ItemMail = { messages: LinkedMessage[]; failures: MailFailure[] };

const newestFirst = (a: LinkedMessage, b: LinkedMessage) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0);




const notBrought = (brought: LinkedMessage[]) => {
  const ids = new Set(brought.map((message) => message.id));
  return (message: LinkedMessage) => !ids.has(message.id);
};


export function startRound(shown: LinkedMail | null, first: LinkedMail, toRead: string[]): LinkedMail {
  const pending = new Set(toRead);
  const failed = new Set(first.mailFailures.map((failure) => failure.accountId));
  const missing = notBrought(first.messages);
  return {
    messages: [...first.messages, ...(shown?.messages ?? []).filter((message) => pending.has(message.accountId) || (failed.has(message.accountId) && missing(message)))].sort(newestFirst),
    mailFailures: [...first.mailFailures, ...(shown?.mailFailures ?? []).filter((failure) => failure.accountId !== undefined && pending.has(failure.accountId))],
  };
}



export function withAccountMail(shown: LinkedMail, account: { id: string; email: string }, answer: Answer<ItemMail>): LinkedMail {
  const otherFailures = shown.mailFailures.filter((failure) => failure.accountId !== account.id);
  if (!answer.ok) return { ...shown, mailFailures: [...otherFailures, { accountId: account.id, accountEmail: account.email, reason: answer.message }] };
  const failed = answer.failures.some((failure) => failure.accountId === account.id);
  const missing = notBrought(answer.messages);
  return {
    messages: [...shown.messages.filter((message) => message.accountId !== account.id || (failed && missing(message))), ...answer.messages].sort(newestFirst),
    mailFailures: [...otherFailures, ...answer.failures],
  };
}
