// Draws the site's icons from the brand mark's geometry (src/components/brand-geometry.json): a black tile, the three
// bars in white, and the brand's light blue (the light theme's `--brand-tile` in src/app/styles/tokens.css) only as
// each bar's shadow, shifted at one angle behind it. It writes the web manifest that names them, all in public/: a
// file there
// is served before the app runs, so a page's icons spend none of the Worker's CPU. `icon.svg`, `favicon.ico` (16, 32
// and 48 px), `apple-icon.png` (180 px, square: the system rounds it). Each pixel is the average of an 8 × 8 grid of
// samples, so the rounded ends read smooth at 16 px. `brand-mark.test.ts` and `manifest.test.ts` fail when what is
// written no longer matches what this draws.
// Usage: node scripts/icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "../src/lib/product.ts";
import { BROWSER_BAR, MANIFEST_BACKGROUND } from "../src/lib/theme.ts";

const geometry = JSON.parse(readFileSync(new URL("../src/components/brand-geometry.json", import.meta.url), "utf8"));
const lightTokens = readFileSync(new URL("../src/app/styles/tokens.css", import.meta.url), "utf8").split(':root[data-theme="dark"]')[0];
function token(name) {
  const value = lightTokens.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`${name} has no six-digit color in the light theme of tokens.css`);
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

const SHADOW = token("--brand-tile");
const TILE = [0, 0, 0];
const BAR = [255, 255, 255];
// Each bar's shadow is one vector with the bar: the pill's capsule extruded along the light's direction —down and
// to the right, as light at some 145 degrees casts it— by this much in geometry units. Its outline follows the
// pill's own border with tangent continuity, so the blue is part of the pill's shape and only its lower-right
// edge shows. A shifted copy, however small, is a second shape: its cap separates from the pill's border at the
// corner, and that separation is the defect, at any size. (The user's call, from their reference.)
const SHADOW_X = 0.39;
const SHADOW_Y = 0.39;
const CANVAS = token("--canvas");
// In a square of `size` units: the tile, then three bars stepping in.
const UNITS = geometry.size;
const TILE_RADIUS = geometry.tileRadius;
const BARS = geometry.bars;

function insideRounded(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// A bar is a capsule: its spine runs from one cap's center to the other's. Its shadow is that capsule extruded
// along the light's direction: the set of points within the cap radius of the spine swept along the same
// direction — a parallelogram — read exactly, with no step and no second shape.
function insideShadow(px, py, bar) {
  const r = bar.h / 2;
  const c1x = bar.x + r;
  const c1y = bar.y + r;
  const c2x = bar.x + bar.w - r;
  const c2y = c1y;
  const corners = [
    [c1x, c1y],
    [c2x, c2y],
    [c2x + SHADOW_X, c2y + SHADOW_Y],
    [c1x + SHADOW_X, c1y + SHADOW_Y],
  ];
  // Inside the parallelogram the distance is zero; outside, it is the nearest edge's.
  let inside = true;
  let nearest = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < 0) inside = false;
    const t = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    nearest = Math.min(nearest, Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))));
  }
  return (inside ? 0 : nearest) <= r;
}

// The mark's color at a point in geometry units, or null where the tile does not paint. A palette says the tile,
// the bars and the shadow's color; a null shadow draws no shadow, and a null tile leaves what is not a bar or a
// shadow unpainted (the monochrome logos).
function colorAt(px, py, rounded, palette = { tile: TILE, bar: BAR, shadow: SHADOW }) {
  if (!insideRounded(px, py, 0, 0, UNITS, UNITS, rounded ? TILE_RADIUS : 0)) return null;
  if (BARS.some((bar) => insideRounded(px, py, bar.x, bar.y, bar.w, bar.h, bar.h / 2))) return palette.bar;
  if (palette.shadow && BARS.some((bar) => insideShadow(px, py, bar))) return palette.shadow;
  return palette.tile;
}

function draw(size, { rounded, background = null, scale = 1, palette }) {
  const samples = size >= 1000 ? 4 : 8;
  const pixels = Buffer.alloc(size * size * 4);
  const unit = UNITS / size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = (col + (sx + 0.5) / samples) * unit;
          const py = (row + (sy + 0.5) / samples) * unit;
          // With `scale` below 1 the mark shrinks toward the center and what it leaves reads as the background.
          const gx = UNITS / 2 + (px - UNITS / 2) / scale;
          const gy = UNITS / 2 + (py - UNITS / 2) / scale;
          const color = colorAt(gx, gy, rounded, palette) ?? background;
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const i = (row * size + col) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
      }
      pixels[i + 3] = Math.round((a / (samples * samples)) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) pixels.copy(rows, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// An .ico holding PNG images, one entry per size.
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([head, ...entries, ...images.map((image) => image.data)]);
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const n3 = (value) => Math.round(value * 1000) / 1000;

// A bar's shadow as one path: the capsule extruded along the light's direction, its arcs and lines tangent where
// they meet, so its outline is the pill's own border continued — the same shape `insideShadow` reads for the
// raster files.
function shadowPath(bar) {
  const r = bar.h / 2;
  const c1 = { x: bar.x + r, y: bar.y + r };
  const c2 = { x: bar.x + bar.w - r, y: c1.y };
  const length = Math.hypot(SHADOW_X, SHADOW_Y);
  const d = { x: SHADOW_X / length, y: SHADOW_Y / length };
  const n = { x: d.y, y: -d.x };
  const at = (c, a, b) => `${n3(c.x + a)} ${n3(c.y + b)}`;
  return [
    `M ${at(c1, r * n.x, r * n.y)}`,
    `L ${at(c2, r * n.x, r * n.y)}`,
    `L ${n3(c2.x + r * n.x + SHADOW_X)} ${n3(c2.y + r * n.y + SHADOW_Y)}`,
    `A ${r} ${r} 0 0 1 ${n3(c2.x - r * n.x + SHADOW_X)} ${n3(c2.y - r * n.y + SHADOW_Y)}`,
    `L ${n3(c1.x - r * n.x + SHADOW_X)} ${n3(c1.y - r * n.y + SHADOW_Y)}`,
    `L ${at(c1, -r * n.x, -r * n.y)}`,
    `A ${r} ${r} 0 0 1 ${at(c1, r * n.x, r * n.y)}`,
    "Z",
  ].join(" ");
}

// The three files as they should be on disk.
export function iconFiles() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNITS} ${UNITS}"><rect width="${UNITS}" height="${UNITS}" rx="${TILE_RADIUS}" fill="${hex(TILE)}"/><g fill="${hex(SHADOW)}">${BARS.map(
    (bar) => `<path d="${shadowPath(bar)}"/>`,
  ).join("")}</g><g fill="${hex(BAR)}">${BARS.map(
    (bar) => `<rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" rx="${bar.h / 2}"/>`,
  ).join("")}</g></svg>\n`;
  return {
    "icon.svg": Buffer.from(svg),
    "favicon.ico": ico([16, 32, 48].map((size) => ({ size, data: png(size, size, draw(size, { rounded: true })) }))),
    "apple-icon.png": png(180, 180, draw(180, { rounded: false })),
  };
}

// The manifest's icons: installable sizes, and the maskable one — its own file, the mark inside the central circle a
// system may crop to (80% of the width), on the canvas the manifest declares as its background.
export function manifestIconFiles() {
  return {
    "icon-192.png": png(192, 192, draw(192, { rounded: true })),
    "icon-512.png": png(512, 512, draw(512, { rounded: true })),
    "icon-maskable-512.png": png(512, 512, draw(512, { rounded: false, background: CANVAS, scale: 0.8 })),
  };
}

// The share image (public/og.png, 1200 × 630) is a supplied design, not drawn here: this script never writes it,
// so running it cannot replace the chosen picture with a drawn one.

// The mark as a logo at 1000 × 1000, drawn by the same source as the icons so the two never drift: the primary
// (a black tile, white bars, their shadow), its light tone (a white tile, black bars), and the two monochromes
// (the bars alone, no tile and no shadow, in black and in white). Each in PNG and in SVG.
const LOGO_SIZE = 1000;
const LOGO_BLACK = [0, 0, 0];
const LOGO_WHITE = [255, 255, 255];
function logoSvg(palette) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNITS} ${UNITS}">${
    palette.tile ? `<rect width="${UNITS}" height="${UNITS}" rx="${TILE_RADIUS}" fill="${hex(palette.tile)}"/>` : ""
  }${
    palette.shadow
      ? `<g fill="${hex(palette.shadow)}">${BARS.map((bar) => `<path d="${shadowPath(bar)}"/>`).join("")}</g>`
      : ""
  }<g fill="${hex(palette.bar)}">${BARS.map(
    (bar) => `<rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" rx="${bar.h / 2}"/>`,
  ).join("")}</g></svg>\n`;
}

export function logoFiles() {
  const tones = {
    "logo-dark": { tile: LOGO_BLACK, bar: LOGO_WHITE, shadow: SHADOW },
    "logo-light": { tile: LOGO_WHITE, bar: LOGO_BLACK, shadow: SHADOW },
    "logo-mono-black": { tile: null, bar: LOGO_BLACK, shadow: null },
    "logo-mono-white": { tile: null, bar: LOGO_WHITE, shadow: null },
  };
  const files = {};
  for (const [name, palette] of Object.entries(tones)) {
    files[`brand/${name}.png`] = png(LOGO_SIZE, LOGO_SIZE, draw(LOGO_SIZE, { rounded: true, palette }));
    files[`brand/${name}.svg`] = Buffer.from(logoSvg(palette));
  }
  return files;
}

// The web manifest every page links: the name a system installs the site by, where it starts, and the icons it asks for. Its
// theme color is the light theme's browser bar; its background, the light canvas behind the maskable mark.
export function webManifest() {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publicDir = new URL("../public/", import.meta.url);
  mkdirSync(new URL("brand/", publicDir), { recursive: true });
  for (const [name, data] of Object.entries({ ...iconFiles(), ...manifestIconFiles(), ...logoFiles() }))
    writeFileSync(new URL(name, publicDir), data);
  writeFileSync(new URL("manifest.webmanifest", publicDir), `${JSON.stringify(webManifest(), null, 2)}\n`);
  console.log("icon.svg, favicon.ico (16, 32, 48), apple-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png, the four logos in public/brand/ (1000x1000, PNG and SVG) and manifest.webmanifest written in public/");
}
