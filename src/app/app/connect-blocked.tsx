"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { browserClient } from "@/lib/supabase/browser";
import { useWorkspace } from "./workspace";




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
      <p>The accounts here are samples, read-only. To connect your own, sign in with Google: it opens a workspace of your own.</p>
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
