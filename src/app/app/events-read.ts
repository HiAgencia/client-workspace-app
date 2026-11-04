import { peekTool, tool, type Answer, type EventsFailure } from "./client-api";
import type { Kept } from "./read-cache";

export type EventsRead<E> = { events: E[]; failures: EventsFailure[]; waiting: number };

type AccountAnswer<E> = Answer<{ events: E[]; failures: EventsFailure[] }>;
type FirstAnswer<E> = { events: E[]; failures: EventsFailure[]; accounts: Array<{ id: string; email: string }>; toRead: string[] };
type Ask = (name: string, input: Record<string, unknown>) => Promise<Answer<unknown>>;
type Peek = (name: string, input: Record<string, unknown>) => Kept<unknown> | null;
type EventKey = { id: string; origin?: string; accountId: string; calendarId?: string; start: string; allDay: boolean };

const keyOf = (event: EventKey) => `${event.origin}:${event.accountId}:${event.calendarId}:${event.id}`;
const startOf = (event: EventKey) => Date.parse(event.allDay ? `${event.start}T00:00:00` : event.start);

function merged<E>(first: FirstAnswer<E>, toRead: string[], answers: Array<AccountAnswer<E> | null>): EventsRead<E> {
  const failures = [...first.failures];
  const byKey = new Map<string, E>();
  const keep = (events: E[]) => {
    for (const event of events) byKey.set(keyOf(event as unknown as EventKey), event);
  };
  keep(first.events);
  answers.forEach((answer, index) => {
    if (answer === null) return;
    if (answer.ok) {
      keep(answer.events);
      failures.push(...answer.failures);
    } else {
      const accountId = toRead[index];
      failures.push({ accountId, accountEmail: first.accounts.find((account) => account.id === accountId)?.email ?? "", reason: answer.message });
    }
  });
  const events = [...byKey.values()].sort((a, b) => startOf(a as unknown as EventKey) - startOf(b as unknown as EventKey));
  return { events, failures, waiting: answers.filter((answer) => answer === null).length };
}

export async function readEvents<E>(
  input: Record<string, unknown>,
  { withAccounts = true, ask = tool as Ask, onArrived }: { withAccounts?: boolean; ask?: Ask; onArrived?: (read: EventsRead<E>) => void } = {},
): Promise<Answer<EventsRead<E>>> {
  const first = (await ask("browse_events", input)) as Answer<FirstAnswer<E>>;
  if (!first.ok) return first;
  const toRead = withAccounts ? first.toRead : [];
  const answers: Array<AccountAnswer<E> | null> = toRead.map(() => null);

  if (toRead.length > 0) onArrived?.(merged(first, toRead, answers));
  await Promise.all(
    toRead.map(async (account, index) => {
      answers[index] = (await ask("browse_events", { ...input, account })) as AccountAnswer<E>;
      if (answers.includes(null)) onArrived?.(merged(first, toRead, answers));
    }),
  );
  return { ok: true, ...merged(first, toRead, answers) };
}

export function keptEvents<E>(input: Record<string, unknown>, { withAccounts = true, peek = peekTool as Peek }: { withAccounts?: boolean; peek?: Peek } = {}): Kept<EventsRead<E>> | null {
  const first = peek("browse_events", input) as Kept<{ ok: true } & FirstAnswer<E>> | null;
  if (!first) return null;
  const toRead = withAccounts ? first.value.toRead : [];
  const parts = toRead.map((account) => peek("browse_events", { ...input, account }) as Kept<AccountAnswer<E>> | null);
  if (parts.some((part) => part === null)) return null;
  const at = Math.min(first.at, ...parts.map((part) => part!.at));
  return { value: merged(first.value, toRead, parts.map((part) => part!.value)), at };
}
