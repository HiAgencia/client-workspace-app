import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";

type CheckboxProps = Omit<ComponentProps<"button">, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};



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
