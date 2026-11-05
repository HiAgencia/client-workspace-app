import type { MetadataRoute } from "next";

const PATHS = ["", "/help", "/privacy", "/cookies", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://brief.hiagencia.com";
  return PATHS.map((path) => ({ url: `${origin}${path}` }));
}
