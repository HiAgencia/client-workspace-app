import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";

export type ButtonVariant = "control" | "primary" | "quiet" | "danger";

type ButtonLook = { variant?: ButtonVariant; size?: "sm"; wide?: boolean; className?: string };



export function buttonClass({ variant = "control", size, wide, className }: ButtonLook = {}): string {
  return cx("btn", variant !== "control" && `btn-${variant}`, size === "sm" && "btn-sm", wide && "btn-wide", className);
}


export function Button({ variant, size, wide, className, type = "button", children, ...props }: ComponentProps<"button"> & ButtonLook) {
  return (
    <button type={type} className={buttonClass({ variant, size, wide, className })} {...props}>
      {typeof children === "string" || typeof children === "number" ? <span className="btn-label">{children}</span> : children}
    </button>
  );
}
