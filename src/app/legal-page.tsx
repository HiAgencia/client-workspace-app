import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { OrgJsonLd } from "@/components/org-json-ld";
import { buttonClass } from "@/components/ui/button";
import { OpenIcon } from "@/components/ui/icons";
import { Link } from "@/components/ui/link";
import type { Language } from "@/lib/language";
import { PRODUCT_NAME } from "@/lib/product";
import type { PublicPath } from "@/lib/seo";
import { LanguageOffer } from "./language-offer";
import { LanguageSwitch } from "./language-switch";
import { SiteFoot } from "./site-foot";

export function LegalPage({
  title,
  lede,
  children,
  lang = "en",
  path,
}: {
  title: string;
  lede: string;
  children: ReactNode;
  lang?: Language;
  path?: PublicPath;
}) {
  return (
    <div className="site-page" data-cascade>
      {path !== undefined && <OrgJsonLd />}
      <header className="site-page-bar">
        <Link href={lang === "es" ? "/es" : "/"} className="brand" aria-label={PRODUCT_NAME}>
          <BrandMark className="brand-mark" />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </Link>
        <span className="site-page-actions">
          {path !== undefined && <LanguageSwitch lang={lang} path={path} />}
          <Link href="/app" className={buttonClass({ variant: "primary", size: "sm" })}>
            <span className="btn-label">{lang === "es" ? "Espacio de trabajo" : "Workspace"}</span>
            <OpenIcon />
          </Link>
        </span>
      </header>
      <main className="site-page-main">
        {path !== undefined && lang === "en" && <LanguageOffer path={path} />}
        <div className="site-page-lead">
          <h1 className="t-h1">{title}</h1>
          <p className="t-body">{lede}</p>
        </div>
        <div className="site-page-sections" data-cascade>
          {children}
        </div>
      </main>
      <SiteFoot lang={lang} />
    </div>
  );
}
