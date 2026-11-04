import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";

type ButtonVariant = "control" | "primary" | "quiet" | "danger";

type ButtonLook = { variant?: ButtonVariant; size?: "sm"; className?: string };

export function buttonClass({ variant = "control", size, className }: ButtonLook = {}): string {
  return cx("btn", variant !== "control" && `btn-${variant}`, size === "sm" && "btn-sm", className);
}

export function Button({ variant, size, className, type = "button", children, ...props }: ComponentProps<"button"> & ButtonLook) {
  return (
    <button type={type} className={buttonClass({ variant, size, className })} {...props}>
      {typeof children === "string" || typeof children === "number" ? <span className="btn-label">{children}</span> : children}
    </button>
  );
}
