import { LOCALE } from "@/lib/dates";

// A number with its word, in the singular or the plural the locale's own rules pick: «1 task», «2 tasks». Every count the
// workspace says goes through here, so no screen decides its plural by hand.
const plural = new Intl.PluralRules(LOCALE);
export function count(n: number, one: string, other: string): string {
  return `${n} ${plural.select(n) === "one" ? one : other}`;
}
