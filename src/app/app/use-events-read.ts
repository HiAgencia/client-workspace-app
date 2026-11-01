"use client";

import { useBoxRead, type BoxRead } from "./boxes";
import { readEvents, type EventsRead } from "./events-read";


export function useEventsRead<E>(input: Record<string, unknown> | null, withAccounts = true): BoxRead<EventsRead<E>> {
  const key = input ? `events:${withAccounts}:${JSON.stringify(input)}` : "events:off";
  return useBoxRead<EventsRead<E>>(input ? () => readEvents<E>(input, { withAccounts }) : null, key);
}
