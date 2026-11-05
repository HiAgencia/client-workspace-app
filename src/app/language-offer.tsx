"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { dismissLanguageOffer, languageOfferDismissed, setLanguage, storedLanguage } from "@/lib/language";
import { otherLanguagePath, type PublicPath } from "@/lib/seo";
import { translate } from "@/lib/strings";

export function LanguageOffer({ path }: { path: PublicPath }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (storedLanguage() !== null || languageOfferDismissed()) return;
    let live = true;
    fetch("/api/language-offer", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { offer: false }))
      .then((body: { offer?: boolean }) => {
        if (live && body.offer === true) setShown(true);
      })
      .catch(() => {
      });
    return () => {
      live = false;
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="language-offer notice" lang="es">
      <p className="t-value notice-text">{translate("es", "offer.availableEs")}</p>
      <span className="language-offer-actions">
        <Link
          href={otherLanguagePath("en", path)}
          className={buttonClass({ variant: "primary", size: "sm" })}
          onClick={() => setLanguage("es")}
        >
          <span className="btn-label">{translate("es", "offer.switchEs")}</span>
        </Link>
        <button
          type="button"
          className={buttonClass({ variant: "quiet", size: "sm" })}
          onClick={() => {
            dismissLanguageOffer();
            setShown(false);
          }}
        >
          <span className="btn-label">{translate("es", "offer.keepEs")}</span>
        </button>
      </span>
    </div>
  );
}
