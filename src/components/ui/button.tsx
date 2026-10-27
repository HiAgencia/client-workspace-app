import type { ComponentProps } from "react";
import { cx } from "@/lib/utils";

export type ButtonVariant = "control" | "primary" | "quiet" | "danger";

type ButtonLook = { variant?: ButtonVariant; size?: "sm"; wide?: boolean; className?: string };

// One primitive for every button and every link drawn as one: the control rises, the primary carries the accent, the
// quiet one takes the interior tone inside a card, and the danger one confirms what cannot be undone.
export function buttonClass({ variant = "control", size, wide, className }: ButtonLook = {}): string {
  return cx("btn", variant !== "control" && `btn-${variant}`, size === "sm" && "btn-sm", wide && "btn-wide", className);
}

// A text label goes in its own piece, trimmed to its capitals, so it centers by its letters beside a title or a pill.
export function Button({ variant, size, wide, className, type = "button", children, ...props }: ComponentProps<"button"> & ButtonLook) {
  return (
    <button type={type} className={buttonClass({ variant, size, wide, className })} {...props}>
      {typeof children === "string" || typeof children === "number" ? <span className="btn-label">{children}</span> : children}
    </button>
  );
}
