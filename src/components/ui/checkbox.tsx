import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";

type CheckboxProps = Omit<ComponentProps<"button">, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

// The product's own checkbox: a button with the checkbox role, so Space and a click toggle it and a screen reader hears
// its state; its box and mark are drawn by the system (`.check`).
export function Checkbox({ checked, onCheckedChange, className, ...props }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cx("check", className)}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  );
}
