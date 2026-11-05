import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/product";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Cookies",
  description: `The cookies and the saved choices ${PRODUCT_NAME} uses, and the ones it does not.`,
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies"
      lede={`${PRODUCT_NAME} does not set advertising or analytics cookies. What it stores is what the workspace needs to keep you signed in and to remember a choice you made.`}
    >
      <section>
        <h2 className="t-group">The session</h2>
        <p className="t-body">
          Signing in sets a session cookie, so the next page still knows who you are. Connecting a Google account sets a short-lived cookie for that step, so the return from Google matches the browser that started it. Both leave when the session or the step ends.
        </p>
      </section>
      <section>
        <h2 className="t-group">Choices kept on this browser</h2>
        <p className="t-body">
          The theme, whether the guide has been seen, and the last place you opened are kept in this browser’s storage. They are not sent to an advertising network. Clearing the browser’s data for this site removes them, and the next visit asks again where it has to.
        </p>
      </section>
      <section>
        <h2 className="t-group">What is not here</h2>
        <p className="t-body">
          There is no measurement cookie and no advertising cookie. If one is added later, this page says so before it is set.
        </p>
      </section>
    </LegalPage>
  );
}
