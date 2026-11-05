import type { Metadata } from "next";
import { buttonClass } from "@/components/ui/button";
import { hashLinkToken } from "@/lib/google/connect-links";
import { PRODUCT_NAME } from "@/lib/product";
import { serviceClient } from "@/lib/supabase/server";
import { LegalPage } from "../../../legal-page";

export const metadata: Metadata = { title: "Connect a Google account", robots: { index: false, follow: false } };

export default async function ConnectLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = serviceClient();
  const { data: link } = await service
    .from("google_connect_links")
    .select("id, node_id, status, expires_at")
    .eq("token_hash", await hashLinkToken(token))
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const live = link !== null;
  const node = live ? (await service.from("nodes").select("name").eq("id", link.node_id).maybeSingle()).data : null;

  return (
    <LegalPage
      title="Connect a Google account"
      lede={
        live
          ? `This link connects one Google account to ${node?.name ?? "a client or project"} in a ${PRODUCT_NAME} workspace.`
          : `This connect link is no longer usable.`
      }
    >
      {live ? (
        <section>
          <h2 className="t-group">What connecting does</h2>
          <p className="t-body">
            Google will ask you to choose an account and to allow reading and changing its calendar events,
            listing its calendars, and reading its mail. The account is not connected yet: whoever created this
            link accepts it in their own session first, and only then can the workspace see that account.
          </p>
          <p className="t-body">
            <a className={buttonClass({ variant: "primary" })} href={`/api/google/connect-link/${token}/start`}>
              <span className="btn-label">Continue with Google</span>
            </a>
          </p>
        </section>
      ) : (
        <section>
          <h2 className="t-group">Ask for a new link</h2>
          <p className="t-body">
            A connect link works once and only for a short while, so an expired, cancelled or already used link
            cannot be opened again. Whoever wants this account connected creates a new one in Settings.
          </p>
        </section>
      )}
    </LegalPage>
  );
}
