import type { Metadata } from "next";
import { AGENCY_NAME, AGENCY_URL } from "@/lib/agency";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/product";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms",
  description: `How ${PRODUCT_NAME} may be used, and what a connected account is for.`,
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      lede={`These terms cover the use of ${PRODUCT_NAME}. The workspace is yours. A connected account is used for the calendar and the mail you connect, and for nothing else.`}
    >
      <section>
        <h2 className="t-group">The workspace</h2>
        <p className="t-body">
          You keep the clients, projects, tasks, notes and events you add. The demo is sample data in its own session. It is not your account and it is not a promise about a particular client.
        </p>
      </section>
      <section>
        <h2 className="t-group">A connected account</h2>
        <p className="t-body">
          Connecting Google lets the workspace read and change that account’s calendar events, and read its mail, so both can sit with the work they belong to. You can disconnect it in Settings. Do not connect an account you are not allowed to use.
        </p>
      </section>
      <section>
        <h2 className="t-group">{ASSISTANT_NAME}</h2>
        <p className="t-body">The chat acts only when you ask. It does not decide for you, and it does not run while you are away.</p>
      </section>
      <section>
        <h2 className="t-group">The service</h2>
        <p className="t-body">
          {PRODUCT_NAME} is developed by {AGENCY_NAME} for the Meta Global AI Developer Hackathon. The service can change. A question about these terms goes to{" "}
          <a className="link" href={AGENCY_URL} target="_blank" rel="noopener">
            {AGENCY_NAME}
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
