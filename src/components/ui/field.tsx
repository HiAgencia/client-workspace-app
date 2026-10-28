import { useId, type ComponentProps } from "react";
import { cx } from "@/lib/utils";

// Every field carries an id and a name, so the browser can tell it apart (autofill, the console's form audit); one the
// screen does not name gets its own.
function useFieldIds(id: string | undefined, name: string | undefined) {
  const own = `field-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return { id: id ?? own, name: name ?? id ?? own };
}

// What is written sinks: its fill, a rim at 3:1 and an inner shadow; its focus takes the accent and a halo.
export function Field({ className, id, name, ...props }: ComponentProps<"input">) {
  return <input className={cx("field", className)} {...useFieldIds(id, name)} {...props} />;
}

export function TextArea({ className, id, name, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx("field", className)} {...useFieldIds(id, name)} {...props} />;
}
