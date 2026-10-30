import { LOCALE } from "@/lib/dates";

// A number with its word, in the singular or the plural the locale's own rules pick: «1 task», «2 tasks». Every count the
// product says —on a screen, in a failure a screen shows, in the chat— goes through here, so no text decides its plural by
// hand; how long until a moment is said in its own words by `dates.ts` («in about an hour»).
const rules = new Intl.PluralRules(LOCALE);

// The word alone, for a number the screen already shows apart from it.
export function plural(n: number, one: string, other: string): string {
  return rules.select(n) === "one" ? one : other;
}

export function count(n: number, one: string, other: string): string {
  return `${n} ${plural(n, one, other)}`;
}
