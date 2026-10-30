"use client";

import { Menu as Base } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cx } from "@/lib/utils";
import { usePopupContainer } from "./popup-layer";
import "@/app/styles/task.css";




export type MenuEntry =
  | { kind: "action"; label: string; onSelect: () => void; disabled?: boolean; tone?: "danger"; detail?: string; id?: string }
  | { kind: "choice"; label: string; value: string | null; options: Array<{ value: string; label: string }>; onChoose: (value: string) => void }
  | { kind: "submenu"; label: string; detail?: string; entries: MenuEntry[] }
  | { kind: "group"; label: string; entries: MenuEntry[] }
  | { kind: "separator" };

type MenuProps = {
  
  
  label: string;
  about?: string;
  
  name?: string;
  entries: MenuEntry[];
  className?: string;
  onOpenChange?: (open: boolean) => void;
  
  finalFocus?: () => HTMLElement | null | undefined;
};




export function Menu({ label, about, name, entries, className, onOpenChange, finalFocus }: MenuProps) {
  const container = usePopupContainer();
  return (
    <Base.Root modal={false} onOpenChange={(open) => onOpenChange?.(open)}>
      <Base.Trigger className={cx("btn btn-quiet btn-sm menu-trigger", className)} aria-label={name ?? (about ? `${label} ${about}` : undefined)}>
        <span className="btn-label">{label}</span>
      </Base.Trigger>
      <Base.Portal container={container}>
        <Base.Positioner className="positioner" sideOffset={6} align="end">
          <Base.Popup className="popup menu-popup" finalFocus={finalFocus ? () => finalFocus() ?? true : undefined}>
            <Entries entries={entries} container={container} />
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

function Entries({ entries, container }: { entries: MenuEntry[]; container: ReturnType<typeof usePopupContainer> }): ReactNode {
  return entries.map((entry, index) => {
    const key = `${entry.kind}-${entry.kind === "action" && entry.id ? entry.id : "label" in entry ? entry.label : index}`;
    switch (entry.kind) {
      case "separator":
        return <Base.Separator key={key} className="menu-separator" />;
      case "action":
        return (
          <Base.Item
            key={key}
            className="option menu-item"
            data-tone={entry.tone}
            disabled={entry.disabled}
            label={entry.label}
            onClick={() => entry.onSelect()}
          >
            <span className="menu-item-label">{entry.label}</span>
            {entry.detail && <span className="menu-item-detail">{entry.detail}</span>}
          </Base.Item>
        );
      case "group":
        return (
          <Base.Group key={key} className="menu-group">
            <Base.GroupLabel className="menu-group-label">{entry.label}</Base.GroupLabel>
            <Entries entries={entry.entries} container={container} />
          </Base.Group>
        );
      case "choice":
        return (
          <Base.SubmenuRoot key={key}>
            <Base.SubmenuTrigger className="option menu-item menu-sub" label={entry.label}>
              <span className="menu-item-label">{entry.label}</span>
              <span className="menu-item-detail">{entry.options.find((option) => option.value === entry.value)?.label ?? ""}</span>
            </Base.SubmenuTrigger>
            <Base.Portal container={container}>
              <Base.Positioner className="positioner" sideOffset={4} alignOffset={-4}>
                <Base.Popup className="popup menu-popup">
                  <Base.RadioGroup value={entry.value} onValueChange={(value: string) => entry.onChoose(value)}>
                    {entry.options.map((option) => (
                      <Base.RadioItem key={option.value} value={option.value} className="option menu-item" closeOnClick label={option.label}>
                        <span className="menu-item-label">{option.label}</span>
                      </Base.RadioItem>
                    ))}
                  </Base.RadioGroup>
                </Base.Popup>
              </Base.Positioner>
            </Base.Portal>
          </Base.SubmenuRoot>
        );
      case "submenu":
        return (
          <Base.SubmenuRoot key={key}>
            <Base.SubmenuTrigger className="option menu-item menu-sub" label={entry.label}>
              <span className="menu-item-label">{entry.label}</span>
              {entry.detail && <span className="menu-item-detail">{entry.detail}</span>}
            </Base.SubmenuTrigger>
            <Base.Portal container={container}>
              <Base.Positioner className="positioner" sideOffset={4} alignOffset={-4}>
                <Base.Popup className="popup menu-popup">
                  <Entries entries={entry.entries} container={container} />
                </Base.Popup>
              </Base.Positioner>
            </Base.Portal>
          </Base.SubmenuRoot>
        );
    }
  });
}
