"use client";

import { buttonClass } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { setLanguage, type Language } from "@/lib/language";
import { otherLanguagePath, type PublicPath } from "@/lib/seo";
import { translate } from "@/lib/strings";

export function LanguageSwitch({ lang, path }: { lang: Language; path: PublicPath }) {
  const next: Language = lang === "es" ? "en" : "es";
  return (
    <Link
      href={otherLanguagePath(lang, path)}
      className={buttonClass({ variant: "quiet", size: "sm" })}
      aria-label={translate(lang, next === "es" ? "language.switchToSpanish" : "language.switchToEnglish")}
      onClick={() => setLanguage(next)}
    >
      <span className="btn-label">{translate(lang, next === "es" ? "language.spanish" : "language.english")}</span>
    </Link>
  );
}
