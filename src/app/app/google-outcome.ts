"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "./workspace";

const OUTCOMES: Record<string, { text: string; tone: "status" | "error" }> = {
  connected: { text: "The Google account is connected here.", tone: "status" },
  cancelled: { text: "Connecting the Google account was cancelled.", tone: "status" },
  failed: { text: "The Google account could not be connected. Try again.", tone: "error" },
  "invalid-state": { text: "That connection link expired or was started elsewhere. Start again from here.", tone: "error" },
  "not-configured": { text: "Connecting Google accounts is not configured on this server.", tone: "error" },
};

export function googleOutcome(outcome: string | null) {
  return outcome ? (OUTCOMES[outcome] ?? null) : null;
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
