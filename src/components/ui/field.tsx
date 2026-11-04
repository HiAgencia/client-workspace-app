import { useId, type ComponentProps } from "react";
import { cx } from "@/lib/utils";

function useFieldIds(id: string | undefined, name: string | undefined) {
  const own = `field-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return { id: id ?? own, name: name ?? id ?? own };
}

export function Field({ className, id, name, ...props }: ComponentProps<"input">) {
  return <input className={cx("field", className)} {...useFieldIds(id, name)} {...props} />;
}

export function TextArea({ className, id, name, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx("field", className)} {...useFieldIds(id, name)} {...props} />;
}
