import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";


export function Field({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx("field", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx("field", className)} {...props} />;
}
