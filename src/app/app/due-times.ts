import type { SelectOption } from "@/components/ui/select";
import { translateNow } from "@/lib/strings";
import { timeLabel } from "./task-row";

export const NO_TIME = "none";
function times(): SelectOption[] {
  return [
    { value: NO_TIME, label: translateNow("quick.noTime") },
    ...Array.from({ length: 48 }, (_, i) => {
      const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
      return { value, label: timeLabel(value) };
    }),
  ];
}

export function dueTimeOptions(current: string | null | undefined): SelectOption[] {
  const all = times();
  if (!current || all.some((option) => option.value === current)) return all;
  const hours = [...all.slice(1), { value: current, label: timeLabel(current) }].sort((a, b) => (a.value < b.value ? -1 : 1));
  return [all[0], ...hours];
}
