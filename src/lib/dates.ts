export type Day = string;

import { currentLanguage } from "./language";
import { translateNow } from "./strings";

export const LOCALE = "en";

function locale(): string {
  return typeof document === "undefined" ? LOCALE : currentLanguage();
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dayOf(date: Date): Day {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDate(day: Day): Date {
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

function shortDay(day: Day, now: Day = today()): string {
  const date = toDate(day);
  const sameYear = day.slice(0, 4) === now.slice(0, 4);
  return new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

export function longDay(day: Day): string {
  return new Intl.DateTimeFormat(locale(), { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(toDate(day));
}

export function monthTitle(day: Day): string {
  return new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(toDate(day));
}

export function dueTone(day: Day | null, now: Day = today()): "alert" | "accent" | "neutral" | "muted" {
  if (!day) return "muted";
  if (day < now) return "alert";
  if (day === now) return "accent";
  return "neutral";
}

export function dueLabel(day: Day | null, now: Day = today()): string {
  if (!day) return translateNow("date.noDate");
  if (day === now) return translateNow("date.today");
  if (day === addDays(now, 1)) return translateNow("date.tomorrow");
  if (day === addDays(now, -1)) return translateNow("date.yesterday");
  return shortDay(day, now);
}

export function weekOf(day: Day, weekStart: number): { from: Day; to: Day } {
  const jsStart = weekStart % 7;
  const back = (toDate(day).getDay() - jsStart + 7) % 7;
  const from = addDays(day, -back);
  return { from, to: addDays(from, 6) };
}

export function instantsOf(from: Day, to: Day): { from: string; to: string } {
  return { from: toDate(from).toISOString(), to: toDate(addDays(to, 1)).toISOString() };
}

export function rangeLabel(from: Day, to: Day): string {
  return new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric" }).formatRange(toDate(from), toDate(to));
}

export function isDay(value: string | null | undefined): value is Day {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toDate(value).getTime());
}

export function untilAgain(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return translateNow("date.tomorrowLower");
  const hours = Math.round(seconds / 3600);
  if (hours >= 2) return translateNow("date.inAboutHours", { hours });
  if (hours === 1) return translateNow("date.inAboutHour");
  return translateNow("date.inFewMinutes");
}

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
  const base = new Date(2024, 0, 7);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(base);
    date.setDate(base.getDate() + ((weekStart % 7) + i));
    return {
      short: new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(date),
      long: new Intl.DateTimeFormat(locale(), { weekday: "long" }).format(date),
    };
  });
}
