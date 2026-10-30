import { LOCALE } from "@/lib/dates";
import type { Theme } from "@/lib/theme";
import type { MailContent } from "./mail-viewer";

// ---- The document the frame paints ----------------------------------------------------------------------------------
// A real message is not to be trusted: it is painted in a frame with no scripts (its `sandbox`, in `mail-viewer.tsx`),
// under a content policy of its own that loads nothing but its styles and inline pictures —and its network images only
// once asked—, with every link opening a new tab that knows nothing of where it came from.

// Whether the message brings colors of its own for a dark screen.
const ownDark = (html: string) => /prefers-color-scheme\s*:\s*dark/i.test(html);

// Its own theme rules answer the mode chosen here, not the system's: they are rewritten to always or never apply.
function forMode(html: string, mode: Theme): string {
  const always = "(min-width: 0px)";
  const never = "(max-width: -1px)";
  return html
    .replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, mode === "dark" ? always : never)
    .replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, mode === "light" ? always : never);
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

export function documentFor(message: MailContent, mode: Theme, images: boolean): { doc: string; adapts: boolean } {
  const html = message.html.trim();
  // A message of plain text has no design of its own: it reads in the product's colors.
  const adapts = html === "" || ownDark(html);
  const scheme = adapts ? mode : "light";
  // A held image is not painted as an image: one without its address draws the browser's broken-picture icon and its
  // alt text, which reads as a failure of the message. It leaves a neutral place that says it is held, and the viewer's
  // «Show images» paints it for real. An image that carries its own bytes —`data:`, `cid:`— loads no network and stays.
  const held = (markup: string) =>
    images
      ? markup
      : markup.replace(/<img\b[^>]*>/gi, (tag) => {
          if (!/\ssrc="https?:/i.test(tag)) return tag;
          const alt = /\salt="([^"]*)"/i.exec(tag)?.[1] ?? "";
          const label = alt.trim() || "Image held";
          return `<span class="cw-held" role="img" aria-label="${escapeAttr(label)}">${escapeText(label)}</span>`;
        });
  const body = html ? held(forMode(html, mode)) :`<pre class="cw-plain">${escapeText(message.text ?? message.snippet)}</pre>`;
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src data: cid:${images ? " https: http:" : ""}`,
    "font-src data:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  // The document declares the language the message declares, so a reader pronounces it in its own; a message that
  // declares none reads in the product's.
  const lang = message.language ?? LOCALE.split("-")[0];
  const doc = `<!doctype html><html lang="${escapeAttr(lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
:root{color-scheme:${scheme};background:Canvas;color:CanvasText}
html,body{margin:0}
body{padding:16px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:break-word}
img{max-width:100%;height:auto}
.cw-held{display:inline-block;max-width:100%;min-width:2rem;min-height:2rem;padding:0.5rem 0.75rem;border:1px dashed GrayText;border-radius:6px;color:GrayText;font-size:13px}
.cw-plain{margin:0;white-space:pre-wrap;font:inherit}
</style></head><body>${body}</body></html>`;
  return { doc, adapts };
}
