import { BrandMark } from "@/components/brand-mark";
import { Link } from "@/components/ui/link";
import { AGENCY_NAME, AGENCY_URL } from "@/lib/agency";
import type { Language } from "@/lib/language";
import { PRODUCT_NAME } from "@/lib/product";

const LINKS = [
  { href: "/help", en: "Help", es: "Ayuda" },
  { href: "/privacy", en: "Privacy", es: "Privacidad" },
  { href: "/cookies", en: "Cookies", es: "Cookies" },
  { href: "/terms", en: "Terms", es: "Términos" },
] as const;

export function SiteFoot({ lang = "en" }: { lang?: Language }) {
  const prefix = lang === "es" ? "/es" : "";
  return (
    <footer className="site-foot">
      <div className="site-foot-in">
        <Link href={prefix || "/"} className="brand" aria-label={PRODUCT_NAME}>
          <BrandMark className="brand-mark" />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </Link>
        <nav className="site-foot-links" aria-label={lang === "es" ? "Información" : "Information"}>
          {LINKS.map((item) => (
            <Link key={item.href} href={`${prefix}${item.href}`} className="link link-meta">
              {lang === "es" ? item.es : item.en}
            </Link>
          ))}
        </nav>
        <p className="t-meta">{lang === "es" ? "Creado para la Meta Global AI Developer Hackathon." : "Built for the Meta Global AI Developer Hackathon."}</p>
        <p className="t-meta">
          {lang === "es" ? "Desarrollado por" : "Developed by"}{" "}
          <a className="link" href={AGENCY_URL} target="_blank" rel="noopener">
            {AGENCY_NAME}
          </a>
        </p>
      </div>
    </footer>
  );
}
