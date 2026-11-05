"use client";

import { useId, useState } from "react";
import { GoogleMark } from "@/components/ui/brands";
import { Button } from "@/components/ui/button";
import { useStrings } from "@/lib/strings";
import { get, post } from "./client-api";
import { useWorkspace } from "./workspace";

export function ConnectSession({
  nodeId,
  email,
  primary = false,
  quiet,
  size,
  detail,
  blocked,
}: {
  nodeId: string;
  email: string;
  primary?: boolean;
  quiet?: boolean;
  size?: "sm";
  detail?: string;
  blocked?: string | null;
}) {
  const { t } = useStrings();
  const detailId = useId();
  const { mailAccounts, saving, notify } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const address = email.toLowerCase();

  async function connect() {
    setBusy(true);
    let accountId = mailAccounts?.find((account) => account.email === address)?.id;
    if (!accountId) {
      const listed = await get<{ accounts: Array<{ id: string; email: string }> }>("/api/accounts");
      accountId = listed.ok ? listed.accounts.find((account) => account.email === address)?.id : undefined;
    }
    if (accountId) {
      const done = await saving(post("/api/accounts", { action: "attach", accountId, nodeId }));
      setBusy(false);
      if (done) notify({ text: t("connect.connectedHere", { email }), tone: "status" });
      return;
    }
    window.location.assign(new URL(`/api/google/connect?node=${nodeId}&as=session`, window.location.origin).toString());
  }

  return (
    <Button
      variant={primary ? "primary" : (quiet ?? Boolean(size)) ? "quiet" : undefined}
      size={size}
      className={detail ? "connect-session node-chip node-connect" : "connect-session"}
      data-connect-session
      onClick={() => void connect()}
      disabled={busy || Boolean(blocked)}
      aria-busy={busy || undefined}
      aria-describedby={detail ? detailId : undefined}
      title={blocked ?? undefined}
    >
      {detail ? (
        <>
          <span className="node-chip-name">
            <GoogleMark className="node-chip-mark" />
            {t("connect.connectEmail", { email })}
          </span>
          <span id={detailId} className="node-chip-detail">
            {detail}
          </span>
        </>
      ) : (
        <>
          <GoogleMark />
          <span className="btn-label">{t("connect.connectEmail", { email })}</span>
        </>
      )}
    </Button>
  );
}
