"use client";

import { Select as Base } from "@base-ui/react/select";
import { Fragment, type ReactElement } from "react";
import { cx } from "@/lib/utils";
import { usePopupContainer } from "./popup-layer";

type Tone = "neutral" | "accent" | "alert" | "warn" | "muted";

export type SelectGroup = { key: string; label: string; color?: string | null };




export type SelectOption = {
  value: string;
  label: string;
  tone?: Tone;
  detail?: string;
  empty?: boolean;
  group?: SelectGroup;
  mark?: (props: { className?: string }) => ReactElement;
};


export function optionRuns(options: SelectOption[]): Array<{ group: SelectGroup | null; options: SelectOption[] }> {
  const runs: Array<{ group: SelectGroup | null; options: SelectOption[] }> = [];
  for (const option of options) {
    const last = runs.at(-1);
    const group = option.group ?? null;
    if (last && (last.group?.key ?? null) === (group?.key ?? null)) last.options.push(option);
    else runs.push({ group, options: [option] });
  }
  return runs;
}

type SelectProps = {
  value: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  
  label: string;
  placeholder?: string;
  
  look?: "field" | "chip";
  
  id?: string;
};


const item = (option: SelectOption, marked: boolean) => (
  <Base.Item key={option.value} value={option.value} className="option" data-empty={option.empty || undefined}>
    {option.mark ? <option.mark className="option-mark" /> : marked && <span className="option-mark" aria-hidden="true" />}
    <Base.ItemText className="option-text">{option.label}</Base.ItemText>
    {option.detail && <span className="option-detail">{option.detail}</span>}
  </Base.Item>
);





export function Select({ value, onChange, options, label, placeholder = "Choose…", look = "field", id }: SelectProps) {
  const chosen = options.find((option) => option.value === value);
  const marked = options.some((option) => option.mark);
  const container = usePopupContainer();
  return (
    <Base.Root
      value={chosen?.value ?? null}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      modal={false}
    >
      <Base.Trigger
        id={id}
        
        aria-label={`${label}: ${chosen?.label ?? placeholder}`}
        className={cx("picker", look === "field" ? "field" : "chip-picker")}
        data-tone={look === "chip" ? chosen?.tone : undefined}
      >
        {chosen?.mark && <chosen.mark className="picker-mark" />}
        <Base.Value className="picker-value" placeholder={placeholder} />
      </Base.Trigger>
      <Base.Portal container={container}>
        <Base.Positioner className="positioner" sideOffset={6} align="start" alignItemWithTrigger={false}>
          <Base.Popup className="popup">
            <Base.List>
              {optionRuns(options).map((run, index) =>
                run.group ? (
                  <Base.Group key={run.group.key} className="option-group">
                    <Base.GroupLabel className="option-group-label">
                      <span className="option-group-mark" data-color={run.group.color ?? undefined} aria-hidden="true" />
                      {run.group.label}
                    </Base.GroupLabel>
                    {run.options.map((option) => item(option, marked))}
                  </Base.Group>
                ) : (
                  <Fragment key={`loose-${index}`}>{run.options.map((option) => item(option, marked))}</Fragment>
                ),
              )}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
