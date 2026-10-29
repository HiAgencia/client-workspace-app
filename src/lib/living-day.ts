// A calendar day some time zone is living now: the UTC day, the one before, or the one after. A day a person sends for
// their own day is checked against it, so a far day is refused wherever it arrives.
const DAY_MS = 86_400_000;

export function isLivingDay(day: string, now = Date.now()): boolean {
  const days = [now - DAY_MS, now, now + DAY_MS].map((moment) => new Date(moment).toISOString().slice(0, 10));
  return days.includes(day);
}
