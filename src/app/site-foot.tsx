import { BrandMark } from "@/components/brand-mark";
import { Link } from "@/components/ui/link";
import { AGENCY_NAME, AGENCY_URL } from "@/lib/agency";
import { PRODUCT_NAME } from "@/lib/product";

const LINKS = [
  { href: "/help", label: "Help" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Terms" },
] as const;

export function SiteFoot() {
  return (
    <footer className="site-foot">
      <div className="site-foot-in">
        <Link href="/" className="brand" aria-label={PRODUCT_NAME}>
          <BrandMark className="brand-mark" />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </Link>
        <nav className="site-foot-links" aria-label="Information">
          {LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="link link-meta">
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="t-meta">Built for the Meta Global AI Developer Hackathon.</p>
        <p className="t-meta">
          Developed by{" "}
          <a className="link" href={AGENCY_URL} target="_blank" rel="noopener">
            {AGENCY_NAME}
          </a>
        </p>
      </div>
    </footer>
  );
}
