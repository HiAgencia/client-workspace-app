import type { MetadataRoute } from "next";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";
import { BROWSER_BAR, MANIFEST_BACKGROUND } from "@/lib/theme";

// The web manifest every page links (Next serves this route at /manifest.webmanifest): the name a system installs
// the site by, where it starts, and the icons it asks for — drawn from the brand mark by `pnpm icons`
// (scripts/icons.mjs). Its theme color is the light theme's browser bar; its background, the light canvas behind
// the maskable mark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: MANIFEST_BACKGROUND,
    theme_color: BROWSER_BAR.light,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icon-maskable-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
