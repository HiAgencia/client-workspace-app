// The icons `icons.mjs` draws, by file name, as they should be on disk: the site's in src/app/, the manifest's in public/.
export function iconFiles(): Record<"icon.svg" | "favicon.ico" | "apple-icon.png", Buffer>;
export function manifestIconFiles(): Record<"icon-192.png" | "icon-512.png" | "icon-maskable-512.png", Buffer>;
