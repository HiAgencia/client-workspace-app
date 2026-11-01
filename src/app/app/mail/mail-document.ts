import { LOCALE } from "@/lib/dates";
import type { Theme } from "@/lib/theme";
import type { MailContent } from "./mail-viewer";







const ownDark = (html: string) => /prefers-color-scheme\s*:\s*dark/i.test(html);


function forMode(html: string, mode: Theme): string {
  const always = "(min-width: 0px)";
  const never = "(max-width: -1px)";
  return html
    .replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, mode === "dark" ? always : never)
    .replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, mode === "light" ? always : never);
}


const ownGround = /^(?:\s|<!--[\s\S]*?-->)*<(?:table|div|center)\b[^>]*(?:\bbgcolor\s*=|\bbackground(?:-color)?\s*:)/i;

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

export function documentFor(message: MailContent, mode: Theme, images: boolean): { doc: string; adapts: boolean } {
  const html = message.html.trim();
  
  const adapts = html === "" || ownDark(html);
  const scheme = adapts ? mode : "light";
  
  
  const turned = !adapts && mode === "dark";
  const turn = turned
    ? `body{background:Canvas;min-height:100vh;filter:invert(.92) hue-rotate(180deg)}
img,video,[background],[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}`
    : "";
  
  
  
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
  
  
  const lang = message.language ?? LOCALE.split("-")[0];
  const doc = `<!doctype html><html lang="${escapeAttr(lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
:root{color-scheme:${scheme};background:Canvas;color:CanvasText}
html,body{margin:0}
body{padding:${ownGround.test(html) ? 0 : 16}px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:break-word}
img{max-width:100%;height:auto}
.cw-held{display:inline-block;max-width:100%;min-width:2rem;min-height:2rem;padding:0.5rem 0.75rem;border:1px dashed GrayText;border-radius:6px;color:GrayText;font-size:13px}
.cw-plain{margin:0;white-space:pre-wrap;font:inherit}
${turn}
</style></head><body>${body}</body></html>`;
  return { doc, adapts };
}
