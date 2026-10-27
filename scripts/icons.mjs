// Draws the site's icons from the brand mark's geometry (src/components/brand-geometry.json) and the accent's colors in
// the light theme (src/app/styles/tokens.css): `src/app/icon.svg`, `src/app/favicon.ico` (16, 32 and 48 px), and
// `src/app/apple-icon.png` (180 px, square: the system rounds it). Each pixel is the average of an 8 × 8 grid of
// samples, so the rounded ends read smooth at 16 px. `brand-mark.test.ts` fails when the written icons no longer match
// what this draws.
// Usage: node scripts/icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const geometry = JSON.parse(readFileSync(new URL("../src/components/brand-geometry.json", import.meta.url), "utf8"));
const lightTokens = readFileSync(new URL("../src/app/styles/tokens.css", import.meta.url), "utf8").split(':root[data-theme="dark"]')[0];
function token(name) {
  const value = lightTokens.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`${name} has no six-digit color in the light theme of tokens.css`);
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

const ACCENT = token("--accent-fill");
const ON_ACCENT = token("--on-accent");
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

function draw(size, { rounded }) {
  const samples = 8;
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
          if (!insideRounded(px, py, 0, 0, UNITS, UNITS, rounded ? TILE_RADIUS : 0)) continue;
          const onBar = BARS.some((bar) => insideRounded(px, py, bar.x, bar.y, bar.w, bar.h, bar.h / 2));
          const color = onBar ? ON_ACCENT : ACCENT;
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

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) pixels.copy(rows, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
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
// The three files as they should be on disk.
export function iconFiles() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNITS} ${UNITS}"><rect width="${UNITS}" height="${UNITS}" rx="${TILE_RADIUS}" fill="${hex(ACCENT)}"/><g fill="${hex(ON_ACCENT)}">${BARS.map(
    (bar) => `<rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" rx="${bar.h / 2}"/>`,
  ).join("")}</g></svg>\n`;
  return {
    "icon.svg": Buffer.from(svg),
    "favicon.ico": ico([16, 32, 48].map((size) => ({ size, data: png(size, draw(size, { rounded: true })) }))),
    "apple-icon.png": png(180, draw(180, { rounded: false })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("../src/app/", import.meta.url);
  for (const [name, data] of Object.entries(iconFiles())) writeFileSync(new URL(name, root), data);
  console.log("icon.svg, favicon.ico (16, 32, 48) and apple-icon.png (180) written in src/app/");
}
