"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { translateNow, type StringKey } from "@/lib/strings";
import { useWorkspace } from "./workspace";

const OUTCOMES: Record<string, { key: StringKey; tone: "status" | "error" }> = {
  connected: { key: "gout.connected", tone: "status" },
  cancelled: { key: "gout.cancelled", tone: "status" },
  failed: { key: "gout.failed", tone: "error" },
  "invalid-state": { key: "gout.invalid", tone: "error" },
  "not-configured": { key: "gout.notConfigured", tone: "error" },
};

function googleOutcome(outcome: string | null) {
  const found = outcome ? (OUTCOMES[outcome] ?? null) : null;
  return found ? { text: translateNow(found.key), tone: found.tone } : null;
}

export function useGoogleOutcome() {
  const outcome = useSearchParams().get("google");
  const { notify } = useWorkspace();
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!outcome || said.current === outcome) return;
    said.current = outcome;
    const words = googleOutcome(outcome);
    if (words) notify(words);
    const address = new URL(window.location.href);
    address.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", `${address.pathname}${address.search}${address.hash}`);
  }, [outcome, notify]);
}
