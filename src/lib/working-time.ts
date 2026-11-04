const START_MINUTE = 9 * 60;
const END_MINUTE = 18 * 60;
const MINUTE = 60_000;

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

export function validZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, found);
  }
  return found;
}

function wallOf(instant: number, zone: string): Wall {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), weekday };
}

function instantOf(year: number, month: number, day: number, minuteOfDay: number, zone: string): number {
  const asUtc = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const offsetAt = (instant: number) => {
    const wall = wallOf(instant, zone);
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(instant / 1000) * 1000;
  };
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

export function isWorkingTime(instant: Date | string | number, zone: string): boolean {
  const wall = wallOf(new Date(instant).getTime(), validZone(zone));
  const minute = wall.hour * 60 + wall.minute + wall.second / 60;
  return isWeekday(wall.weekday) && minute >= START_MINUTE && minute <= END_MINUTE;
}

export function workingMinutesBetween(from: Date | string | number, to: Date | string | number, zone: string): number {
  const tz = validZone(zone);
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!(end > start)) return 0;
  let total = 0;
  const first = wallOf(start, tz);
  for (let cursor = Date.UTC(first.year, first.month - 1, first.day); ; cursor += 86_400_000) {
    const date = new Date(cursor);
    const [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const opens = instantOf(year, month, day, START_MINUTE, tz);
    if (opens > end) break;
    if (isWeekday(date.getUTCDay())) {
      const closes = instantOf(year, month, day, END_MINUTE, tz);
      const overlap = Math.min(closes, end) - Math.max(opens, start);
      if (overlap > 0) total += overlap / MINUTE;
    }
  }
  return total;
}

export function workingMinutesBefore(to: Date | string | number, minutes: number, zone: string): Date {
  const tz = validZone(zone);
  const now = wallOf(new Date(to).getTime(), tz);
  let wall = Date.UTC(now.year, now.month - 1, now.day, now.hour, now.minute, now.second) + (new Date(to).getTime() % 1000);
  const dayOf = (value: number) => Math.floor(value / 86_400_000) * 86_400_000;
  const previousWorkingClose = (value: number) => {
    let day = dayOf(value) - 86_400_000;
    while (!isWeekday(new Date(day).getUTCDay())) day -= 86_400_000;
    return day + END_MINUTE * MINUTE;
  };
  const weekday = new Date(dayOf(wall)).getUTCDay();
  const minuteOfDay = (wall - dayOf(wall)) / MINUTE;
  if (!isWeekday(weekday) || minuteOfDay < START_MINUTE) wall = previousWorkingClose(wall);
  else if (minuteOfDay > END_MINUTE) wall = dayOf(wall) + END_MINUTE * MINUTE;
  let left = minutes * MINUTE;
  for (;;) {
    const available = wall - (dayOf(wall) + START_MINUTE * MINUTE);
    if (left <= available) {
      wall -= left;
      break;
    }
    left -= available;
    wall = previousWorkingClose(wall);
  }
  const date = new Date(dayOf(wall));
  const opens = instantOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), START_MINUTE, tz);
  return new Date(opens + (wall - dayOf(wall) - START_MINUTE * MINUTE));
}
