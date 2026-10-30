import { LOCALE } from "@/lib/dates";



const rules = new Intl.PluralRules(LOCALE);


export function plural(n: number, one: string, other: string): string {
  return rules.select(n) === "one" ? one : other;
}

export function count(n: number, one: string, other: string): string {
  return `${n} ${plural(n, one, other)}`;
}
