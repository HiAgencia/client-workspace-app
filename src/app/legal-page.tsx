import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { buttonClass } from "@/components/ui/button";
import { OpenIcon } from "@/components/ui/icons";
import { Link } from "@/components/ui/link";
import { PRODUCT_NAME } from "@/lib/product";
import { SiteFoot } from "./site-foot";

export function LegalPage({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <div className="site-page" data-cascade>
      <header className="site-page-bar">
        <Link href="/" className="brand" aria-label={PRODUCT_NAME}>
          <BrandMark className="brand-mark" />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </Link>
        <Link href="/app" className={buttonClass({ variant: "primary", size: "sm" })}>
          <span className="btn-label">Workspace</span>
          <OpenIcon />
        </Link>
      </header>
      <main className="site-page-main">
        <div className="site-page-lead">
          <h1 className="t-h1">{title}</h1>
          <p className="t-body">{lede}</p>
        </div>
        <div className="site-page-sections" data-cascade>
          {children}
        </div>
      </main>
      <SiteFoot />
    </div>
  );
}
