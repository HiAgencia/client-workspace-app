import type { Metadata } from "next";
import { Link } from "@/components/ui/link";
import { AGENCY_NAME, AGENCY_URL } from "@/lib/agency";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = pageMetadata({
  lang: "en",
  path: "/privacy",
  title: "Privacy",
  description: `What ${PRODUCT_NAME} keeps, what a connected account is used for, and how to remove it.`,
});

export default function PrivacyPage() {
  return (
    <LegalPage
      path="/privacy"
      title="Privacy"
      lede={`${PRODUCT_NAME} keeps what you put in your workspace, and what a sign-in or a connected account needs in order to work. This is that list.`}
    >
      <section>
        <h2 className="t-group">Your sign-in</h2>
        <p className="t-body">
          Signing in with Google gives the workspace your name, your email and your photo, so the sidebar and the profile can show them. The session that keeps you signed in is a cookie. The demo is a separate session with sample data, not your Google account.
        </p>
      </section>
      <section>
        <h2 className="t-group">What you write</h2>
        <p className="t-body">
          Clients, projects, tasks, descriptions, notes, subtasks and the events you create stay in your workspace. A connected Google account can also read and change that account’s calendar events, and read its mail, so the workspace can show them beside the work they belong to. The token for that account is stored encrypted on the server. You disconnect an account in Settings.
        </p>
      </section>
      <section>
        <h2 className="t-group">{ASSISTANT_NAME}</h2>
        <p className="t-body">
          The chat runs only when you ask it to. What you send in that turn goes to the model that answers. It does not act on the workspace on its own.
        </p>
      </section>
      <section>
        <h2 className="t-group">On this browser</h2>
        <p className="t-body">
          This browser remembers the theme, the language chosen on the public pages, whether the offer of the Spanish version was dismissed, whether you have seen the guide, and the last place you opened, so the next visit can resume there. Those are not advertising cookies. The list is on the <Link href="/cookies">Cookies</Link> page.
        </p>
      </section>
      <section>
        <h2 className="t-group">A question about this</h2>
        <p className="t-body">
          {PRODUCT_NAME} is developed by {AGENCY_NAME}. A question about what is kept goes to{" "}
          <a className="link" href={AGENCY_URL} target="_blank" rel="noopener">
            {AGENCY_NAME}
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
