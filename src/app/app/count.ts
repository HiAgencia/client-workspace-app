import { LOCALE } from "@/lib/dates";



const plural = new Intl.PluralRules(LOCALE);
export function count(n: number, one: string, other: string): string {
  return `${n} ${plural.select(n) === "one" ? one : other}`;
}
