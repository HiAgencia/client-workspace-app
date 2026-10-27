// Calendar days as `YYYY-MM-DD`, counted in the browser's own calendar: a day is never shifted by a time zone, because
// it is built from its year, month, and day and never parsed as an instant.

export type Day = string;

// Dates read in the interface's language, whatever the browser's: a screen in English does not name its days in another.
export const LOCALE = "en";

const pad = (n: number) => String(n).padStart(2, "0");

export function dayOf(date: Date): Day {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDate(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): Day {
  return dayOf(new Date());
}

export function addDays(day: Day, offset: number): Day {
  const date = toDate(day);
  date.setDate(date.getDate() + offset);
  return dayOf(date);
}

export function addMonths(day: Day, offset: number): Day {
  const date = toDate(day);
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), last));
  return dayOf(target);
}

// "Oct 28", with the year only when it is not this year's.
export function shortDay(day: Day, now: Day = today()): string {
  const date = toDate(day);
  const sameYear = day.slice(0, 4) === now.slice(0, 4);
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

export function longDay(day: Day): string {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(toDate(day));
}

export function monthTitle(day: Day): string {
  return new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" }).format(toDate(day));
}

// Where a due day stands against today: what is late, what is today, and what is ahead read apart.
export function dueTone(day: Day | null, now: Day = today()): "alert" | "accent" | "neutral" | "muted" {
  if (!day) return "muted";
  if (day < now) return "alert";
  if (day === now) return "accent";
  return "neutral";
}

export function dueLabel(day: Day | null, now: Day = today()): string {
  if (!day) return "No date";
  if (day === now) return "Today";
  if (day === addDays(now, 1)) return "Tomorrow";
  if (day === addDays(now, -1)) return "Yesterday";
  return shortDay(day, now);
}

// The first day of the week where the browser says it (1 = Monday … 7 = Sunday), Monday otherwise.
export function firstWeekday(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    return locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay ?? 1;
  } catch {
    return 1;
  }
}

// The weeks of a month for a calendar grid, each a row of seven days (days of the neighbor months included).
export function monthGrid(day: Day, weekStart: number): Day[][] {
  const date = toDate(day);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const jsStart = weekStart % 7;
  const lead = (first.getDay() - jsStart + 7) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  const weeks: Day[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: Day[] = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(start);
      cell.setDate(start.getDate() + w * 7 + d);
      week.push(dayOf(cell));
    }
    weeks.push(week);
    const nextWeekStart = new Date(start);
    nextWeekStart.setDate(start.getDate() + (w + 1) * 7);
    if (nextWeekStart.getMonth() !== date.getMonth() && w >= 3) break;
  }
  return weeks;
}

export function weekdayNames(weekStart: number): Array<{ short: string; long: string }> {
  const base = new Date(2024, 0, 7); // a Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(base);
    date.setDate(base.getDate() + ((weekStart % 7) + i));
    return {
      short: new Intl.DateTimeFormat(LOCALE, { weekday: "short" }).format(date),
      long: new Intl.DateTimeFormat(LOCALE, { weekday: "long" }).format(date),
    };
  });
}
