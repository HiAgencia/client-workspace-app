import { addDays, LOCALE, type Day } from "@/lib/dates";
import { currentLanguage } from "@/lib/language";
import { translateNow } from "@/lib/strings";

export function mailWhen(iso: string, now: Day): string {
  const date = new Date(iso);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const locale = typeof document === "undefined" ? LOCALE : currentLanguage();
  if (day === now) return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  if (day === addDays(now, -1)) return translateNow("date.yesterday");
  const sameYear = date.getFullYear() === Number(now.slice(0, 4));
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}
