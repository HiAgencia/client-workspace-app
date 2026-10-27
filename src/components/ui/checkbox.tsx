import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";

type CheckboxProps = Omit<ComponentProps<"button">, "onChange" | "onClick" | "role" | "type"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

// The product's own checkbox: a button with the checkbox role, so Space and a click toggle it and a screen reader hears
// its state; its box and mark are drawn by the system (`.check`). What it is and how it toggles go after the passed
// props, so none of them can replace it.
export function Checkbox({ checked, onCheckedChange, className, ...props }: CheckboxProps) {
  return (
    <button
      {...props}
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cx("check", className)}
      onClick={() => onCheckedChange(!checked)}
    />
  );
}
