"use client";

import { Select as Base } from "@base-ui/react/select";
import { cx } from "@/lib/utils";

type Tone = "neutral" | "accent" | "alert" | "warn" | "muted";
export type SelectOption = { value: string; label: string; tone?: Tone };

type SelectProps = {
  value: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  
  label: string;
  placeholder?: string;
  
  look?: "field" | "chip";
  className?: string;
};




export function Select({ value, onChange, options, label, placeholder = "Choose…", look = "field", className }: SelectProps) {
  const chosen = options.find((option) => option.value === value);
  return (
    <Base.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      modal={false}
    >
      <Base.Trigger
        
        aria-label={`${label}: ${chosen?.label ?? placeholder}`}
        className={cx("picker", look === "field" ? "field" : "chip-picker", className)}
        data-tone={look === "chip" ? chosen?.tone : undefined}
      >
        <Base.Value className="picker-value" placeholder={placeholder} />
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner className="positioner" sideOffset={6} align="start" alignItemWithTrigger={false}>
          <Base.Popup className="popup">
            <Base.List>
              {options.map((option) => (
                <Base.Item key={option.value} value={option.value} className="option">
                  <Base.ItemText>{option.label}</Base.ItemText>
                </Base.Item>
              ))}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
