import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";

// What is written sinks: its fill, a rim at 3:1 and an inner shadow; its focus takes the accent and a halo.
export function Field({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx("field", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx("field", className)} {...props} />;
}
