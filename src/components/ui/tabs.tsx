"use client";

import { useRef, type KeyboardEvent } from "react";
import { cx } from "@/lib/utils";
import { usePiece } from "./use-piece";

type TabsProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; controls: string }>;
  label: string;
  className?: string;
};

// Short, exclusive views in a segmented control: a sunken rail and one raised piece that travels to the chosen tab.
// Arrows move between tabs, as the tabs pattern asks.
export function Tabs<T extends string>({ value, onChange, options, label, className }: TabsProps<T>) {
  const rail = useRef<HTMLDivElement>(null);
  usePiece(rail, '[aria-selected="true"]');

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((option) => option.value === value);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => rail.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.value}"]`)?.focus());
  }

  return (
    <div ref={rail} role="tablist" aria-label={label} className={cx("seg", className)} onKeyDown={onKey}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          id={`tab-${option.controls}`}
          data-tab={option.value}
          aria-selected={option.value === value}
          aria-controls={option.controls}
          tabIndex={option.value === value ? 0 : -1}
          className="seg-option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
