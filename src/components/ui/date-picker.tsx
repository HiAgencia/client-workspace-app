"use client";

import { Popover } from "@base-ui/react/popover";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  addDays,
  addMonths,
  dueLabel,
  dueTone,
  firstWeekday,
  longDay,
  monthGrid,
  monthTitle,
  today,
  weekdayNames,
  type Day,
} from "@/lib/dates";
import { cx } from "@/lib/utils";

type DatePickerProps = {
  value: Day | null;
  onChange: (value: Day | null) => void;
  label: string;
  look?: "field" | "chip";
  className?: string;
};

// The product's date field: a trigger with the day in words, and a calendar the system draws. Arrows move a day or a
// week, Page Up and Page Down a month, Home and End the week's ends, Enter picks, Escape closes; "Today", "Tomorrow"
// and "No date" are one press away.
export function DatePicker({ value, onChange, label, look = "field", className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const now = today();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        // The name carries the visible words, and the full day goes as its description.
        aria-label={`${label}: ${dueLabel(value, now)}`}
        aria-description={value ? longDay(value) : undefined}
        className={cx("picker", look === "field" ? "field" : "chip-picker", className)}
        data-tone={look === "chip" ? dueTone(value, now) : undefined}
      >
        <span className={cx("picker-value", !value && "picker-placeholder")}>{dueLabel(value, now)}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="positioner" sideOffset={6} align="start">
          <Popover.Popup
            className="popup calendar"
            aria-label={label}
            // The chosen day (or today) takes the focus on opening, so the arrows start from it.
            initialFocus={() => document.querySelector<HTMLElement>('.calendar .cal-day[tabindex="0"]')}
          >
            {open && (
              <Calendar
                value={value}
                onPick={(day) => {
                  onChange(day);
                  setOpen(false);
                }}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Calendar({ value, onPick }: { value: Day | null; onPick: (day: Day | null) => void }) {
  const now = today();
  const [active, setActive] = useState<Day>(value ?? now);
  const weekStart = useMemo(() => firstWeekday(), []);
  const names = useMemo(() => weekdayNames(weekStart), [weekStart]);
  const weeks = monthGrid(active, weekStart);
  const month = active.slice(0, 7);
  const grid = useRef<HTMLTableElement>(null);

  function move(next: Day) {
    setActive(next);
    // The day keeps the focus as it moves, also into another month.
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  }

  function onKey(event: KeyboardEvent<HTMLTableElement>) {
    const position = (weeks.flat().indexOf(active) % 7 + 7) % 7;
    const steps: Record<string, () => Day> = {
      ArrowLeft: () => addDays(active, -1),
      ArrowRight: () => addDays(active, 1),
      ArrowUp: () => addDays(active, -7),
      ArrowDown: () => addDays(active, 7),
      PageUp: () => addMonths(active, -1),
      PageDown: () => addMonths(active, 1),
      Home: () => addDays(active, -position),
      End: () => addDays(active, 6 - position),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    move(step());
  }

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => move(addMonths(active, -1))}>
          Previous
        </button>
        <p className="t-label" aria-live="polite">
          {monthTitle(active)}
        </p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => move(addMonths(active, 1))}>
          Next
        </button>
      </div>
      <table className="cal-grid" role="grid" ref={grid} onKeyDown={onKey} aria-label={monthTitle(active)}>
        <thead>
          <tr>
            {names.map((name) => (
              <th key={name.long} scope="col" abbr={name.long} className="t-meta">
                {name.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const outside = day.slice(0, 7) !== month;
                return (
                  <td key={day}>
                    <button
                      type="button"
                      className="cal-day"
                      data-day={day}
                      data-outside={outside || undefined}
                      tabIndex={day === active ? 0 : -1}
                      aria-label={longDay(day)}
                      aria-pressed={day === value}
                      aria-current={day === now ? "date" : undefined}
                      onClick={() => onPick(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cal-foot">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onPick(now)}>
          Today
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onPick(addDays(now, 1))}>
          Tomorrow
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onPick(null)} disabled={value === null}>
          No date
        </button>
      </div>
    </div>
  );
}
