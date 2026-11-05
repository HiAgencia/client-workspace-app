"use client";

import { Link } from "@/components/ui/link";
import { GoogleMark } from "@/components/ui/brands";
import { buttonClass } from "@/components/ui/button";
import { AddIcon } from "@/components/ui/icons";
import { translateNow, useStrings } from "@/lib/strings";
import { ConnectSession } from "./connect-session";
import { useWorkspace } from "./workspace";

export type ConnectWay = { kind: "start" } | { kind: "own"; nodeId: string; email: string } | { kind: "settings" };

export function useConnectWay(): ConnectWay | null {
  const { tree, person } = useWorkspace();
  if (tree === null) return null;
  const google = person !== null && !person.isAnonymous;
  if (tree.length === 0) return google ? { kind: "start" } : { kind: "settings" };
  const own = tree.filter((node) => node.parentId === null && node.kind === "project");
  if (google && person.email && own.length === 1) return { kind: "own", nodeId: own[0].id, email: person.email };
  return { kind: "settings" };
}

export function connectWords(way: ConnectWay | null, what: string): string {
  return way?.kind === "start" ? translateNow("connect.addFirst", { what }) : translateNow("connect.connectToSee", { what });
}

export function ConnectOffer({ way, quiet = false }: { way: ConnectWay | null; quiet?: boolean }) {
  const { t } = useStrings();
  if (!way) return null;
  const look = buttonClass({ size: "sm", variant: quiet ? "quiet" : undefined });
  if (way.kind === "start") {
    return (
      <Link href="/app" className={look} data-connect-offer="start">
        <AddIcon />
        <span className="btn-label">{t("connect.addOwnProject")}</span>
      </Link>
    );
  }
  if (way.kind === "own") return <ConnectSession nodeId={way.nodeId} email={way.email} size="sm" quiet={quiet} />;
  return (
    <Link href="/app/settings#accounts-settings" className={look} data-connect-offer="settings">
      <GoogleMark />
      <span className="btn-label">{t("mail.connectGoogle")}</span>
    </Link>
  );
}
