import type { Metadata } from "next";
import { AGENCY_NAME, AGENCY_URL } from "@/lib/agency";
import type { Language } from "@/lib/language";
import { PRODUCT_NAME } from "@/lib/product";

export const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://brief.hiagencia.com";

export const PUBLIC_PATHS = ["", "/help", "/privacy", "/cookies", "/terms"] as const;
export type PublicPath = (typeof PUBLIC_PATHS)[number];

export function publicUrl(lang: Language, path: PublicPath): string {
  return lang === "es" ? `${SITE_ORIGIN}/es${path}` : `${SITE_ORIGIN}${path || "/"}`;
}

export function otherLanguagePath(lang: Language, path: PublicPath): string {
  return lang === "es" ? path || "/" : `/es${path}`;
}

const SHARE_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: PRODUCT_NAME,
} as const;

export function pageMetadata({
  lang,
  path,
  title,
  description,
}: {
  lang: Language;
  path: PublicPath;
  title: string | null;
  description: string;
}): Metadata {
  const canonical = publicUrl(lang, path);
  const fullTitle = title === null ? PRODUCT_NAME : `${title} · ${PRODUCT_NAME}`;
  return {
    title: title === null ? { absolute: PRODUCT_NAME } : title,
    description,
    alternates: {
      canonical,
      languages: {
        en: publicUrl("en", path),
        es: publicUrl("es", path),
        "x-default": publicUrl("en", path),
      },
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: PRODUCT_NAME,
      locale: lang === "es" ? "es_ES" : "en_US",
      url: canonical,
      title: fullTitle,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [SHARE_IMAGE.url],
    },
  };
}

export const PRODUCT_DESCRIPTION_ES =
  "Cada tarea, nota, calendario y mensaje de cada cliente y proyecto en un solo lugar, con un chat que actúa cuando se le pide.";

export function organizationJsonLd(): string {
  const value = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: AGENCY_NAME,
    url: AGENCY_URL,
    logo: `${SITE_ORIGIN}/apple-icon.png`,
  };
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
