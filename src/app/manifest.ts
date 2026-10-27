import type { MetadataRoute } from "next";
import { BROWSER_BAR, MANIFEST_BACKGROUND } from "@/lib/theme";





export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "client-workspace",
    short_name: "client-workspace",
    description:
      "Work organized by project: tasks, decisions, links, and calendars in one tree, with a chat and your coding agent on the same place.",
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
