import type { SelectOption } from "@/components/ui/select";
import { timeLabel } from "./task-row";

export const NO_TIME = "none";
const TIMES: SelectOption[] = [
  { value: NO_TIME, label: "No time" },
  ...Array.from({ length: 48 }, (_, i) => {
    const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
    return { value, label: timeLabel(value) };
  }),
];

export function dueTimeOptions(current: string | null | undefined): SelectOption[] {
  if (!current || TIMES.some((option) => option.value === current)) return TIMES;
  const hours = [...TIMES.slice(1), { value: current, label: timeLabel(current) }].sort((a, b) => (a.value < b.value ? -1 : 1));
  return [TIMES[0], ...hours];
}
