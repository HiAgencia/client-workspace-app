import { tool, type Answer, type EventsFailure } from "./client-api";







export type EventsRead<E> = { events: E[]; failures: EventsFailure[]; waiting: number };

type AccountAnswer<E> = Answer<{ events: E[]; failures: EventsFailure[] }>;
type FirstAnswer<E> = { events: E[]; failures: EventsFailure[]; accounts: Array<{ id: string; email: string }>; toRead: string[] };
type Ask = (name: string, input: Record<string, unknown>) => Promise<Answer<unknown>>;
type EventKey = { id: string; origin?: string; accountId: string; calendarId?: string; start: string; allDay: boolean };

const keyOf = (event: EventKey) => `${event.origin}:${event.accountId}:${event.calendarId}:${event.id}`;
const startOf = (event: EventKey) => Date.parse(event.allDay ? `${event.start}T00:00:00` : event.start);



export async function readEvents<E>(
  input: Record<string, unknown>,
  { withAccounts = true, ask = tool as Ask, onArrived }: { withAccounts?: boolean; ask?: Ask; onArrived?: (read: EventsRead<E>) => void } = {},
): Promise<Answer<EventsRead<E>>> {
  const first = (await ask("browse_events", input)) as Answer<FirstAnswer<E>>;
  if (!first.ok) return first;
  const toRead = withAccounts ? first.toRead : [];
  const answers: Array<AccountAnswer<E> | null> = toRead.map(() => null);

  
  const arrived = (): EventsRead<E> => {
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
  };

  if (toRead.length > 0) onArrived?.(arrived());
  await Promise.all(
    toRead.map(async (account, index) => {
      answers[index] = (await ask("browse_events", { ...input, account })) as AccountAnswer<E>;
      if (answers.includes(null)) onArrived?.(arrived());
    }),
  );
  return { ok: true, ...arrived() };
}
