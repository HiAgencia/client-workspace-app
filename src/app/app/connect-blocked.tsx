
export type ConnectBlocked = "demo" | "not_configured" | null;

const reasons: Record<Exclude<ConnectBlocked, null>, string> = {
  demo: "The demo shows its own sample work and does not connect Google accounts. Sign in with Google to connect yours.",
  not_configured: "Connecting Google accounts is not configured on this server yet.",
};

export function ConnectBlockedNote({ reason }: { reason: ConnectBlocked }) {
  return reason ? (
    <p className="inline-note" data-connect-blocked={reason}>
      {reasons[reason]}
    </p>
  ) : null;
}
