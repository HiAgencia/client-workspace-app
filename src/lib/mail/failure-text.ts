import { translateNow } from "@/lib/strings";

export function mailFailureText(failure: { accountEmail: string; reason: string; partial?: boolean }): string {
  const reason = failure.reason.replace(/\.+$/, "");
  return failure.partial ? translateNow("mailfail.in", { email: failure.accountEmail, reason }) : translateNow("mailfail.couldNot", { email: failure.accountEmail, reason });
}
