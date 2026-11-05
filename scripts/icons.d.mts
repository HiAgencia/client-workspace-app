// What `icons.mjs` writes in public/: the icons by file name, as they should be on disk, and the web manifest.
export function iconFiles(): Record<"icon.svg" | "favicon.ico" | "apple-icon.png", Buffer>;
export function manifestIconFiles(): Record<"icon-192.png" | "icon-512.png" | "icon-maskable-512.png", Buffer>;
export function ogFile(): Record<"og.png", Buffer>;
export function logoFiles(): Record<string, Buffer>;
export function webManifest(): {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; type: string; sizes: string; purpose: string }>;
};
