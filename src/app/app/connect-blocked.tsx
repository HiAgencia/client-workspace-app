"use client";

import { useState } from "react";
import { GoogleMark } from "@/components/ui/brands";
import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "@/lib/supabase/google-sign-in";
import { useStrings } from "@/lib/strings";
import { useWorkspace } from "./workspace";

export type ConnectBlocked = "demo" | "not_configured" | null;

export function ConnectBlockedNote({ reason, samples }: { reason: ConnectBlocked; samples: boolean }) {
  const { t } = useStrings();
  const { config } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!reason) return null;
  if (reason === "not_configured") return <p className="inline-note">{t("blocked.notConfigured")}</p>;

  async function signIn() {
    setBusy(true);
    setFailed(null);
    const { error } = await signInWithGoogle(config);
    if (error) {
      setBusy(false);
      setFailed(error.message);
    }
  }

  return (
    <div className="inline-note connect-blocked" data-connect-blocked={reason}>
      <p>
        {samples
          ? t("blocked.samples")
          : t("blocked.toConnect")}
      </p>
      <div>
        <Button size="sm" onClick={() => void signIn()} disabled={busy} aria-busy={busy}>
          <GoogleMark />
          <span className="btn-label">{t("profile.signInGoogle")}</span>
        </Button>
      </div>
      {failed && (
        <p role="alert" data-tone="alert">
          {t("profile.signInUnavailable", { message: failed })}
        </p>
      )}
    </div>
  );
}
