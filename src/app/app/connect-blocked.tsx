"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { browserClient } from "@/lib/supabase/browser";
import { useWorkspace } from "./workspace";

// Why a Google account cannot be connected from here, said the same on every screen that offers connecting, with the
// way out when there is one: a session opened without an account signs in with Google, which opens the person's own
// workspace and leaves this one behind.
export type ConnectBlocked = "demo" | "not_configured" | null;

export function ConnectBlockedNote({ reason }: { reason: ConnectBlocked }) {
  const { config } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!reason) return null;
  if (reason === "not_configured") return <p className="inline-note">Connecting Google accounts is not configured on this server yet.</p>;

  async function signIn() {
    setBusy(true);
    setFailed(null);
    const redirectTo = new URL("/auth/callback", window.location.origin).toString();
    const { error } = await browserClient(config).auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setBusy(false);
      setFailed(error.message);
    }
  }

  return (
    <div className="inline-note connect-blocked" data-connect-blocked={reason}>
      <p>To connect a Google calendar, sign in with Google. This workspace was opened without an account; signing in opens one of your own.</p>
      <div>
        <Button size="sm" onClick={() => void signIn()} disabled={busy} aria-busy={busy}>
          Sign in with Google
        </Button>
      </div>
      {failed && (
        <p role="alert" data-tone="alert">
          Google sign-in is not available: {failed}
        </p>
      )}
    </div>
  );
}
