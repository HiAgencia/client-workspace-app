export function mailFailureText(failure: { accountEmail: string; reason: string; partial?: boolean }): string {
  const reason = failure.reason.replace(/\.+$/, "");
  return failure.partial ? `In ${failure.accountEmail}, ${reason}.` : `The mail of ${failure.accountEmail} could not be loaded: ${reason}.`;
}
