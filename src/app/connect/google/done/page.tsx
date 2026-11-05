import type { Metadata } from "next";
import { LegalPage } from "../../../legal-page";

export const metadata: Metadata = { title: "Connect a Google account", robots: { index: false, follow: false } };

const OUTCOMES: Record<string, { title: string; lede: string; body: string }> = {
  authorized: {
    title: "Account authorized",
    lede: "Google authorized the account you chose.",
    body: "Nothing is connected yet. Go back to the browser where you created the link and accept this account there; only then will the workspace read its calendars and mail. You can close this page.",
  },
  cancelled: {
    title: "Nothing was connected",
    lede: "The connection was cancelled at Google.",
    body: "No account was authorized and nothing was stored. The link can be opened again while it is still live, or a new one can be created in Settings.",
  },
  failed: {
    title: "The account could not be authorized",
    lede: "Google's answer could not be completed here.",
    body: "Nothing was connected. Open the link again and make sure every calendar and mail permission is allowed, or create a new link in Settings.",
  },
  "invalid-link": {
    title: "This link is no longer usable",
    lede: "The connect link expired, was cancelled, or was already used.",
    body: "Whoever wants this account connected creates a new link in Settings and opens that one here.",
  },
  "not-configured": {
    title: "Connecting is not available",
    lede: "This server cannot connect Google accounts right now.",
    body: "Nothing was connected. The workspace's Settings say when connecting becomes available.",
  },
};

export default async function ConnectDonePage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  const { outcome } = await searchParams;
  const shown = OUTCOMES[outcome ?? ""] ?? OUTCOMES.failed;
  return (
    <LegalPage title={shown.title} lede={shown.lede}>
      <section>
        <p className="t-body">{shown.body}</p>
      </section>
    </LegalPage>
  );
}
