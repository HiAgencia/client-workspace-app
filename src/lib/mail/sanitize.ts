import { Parser } from "htmlparser2";

// A message's HTML before it leaves the server for the viewer: its design stays —tables, inline styles, its own style
// sheet, images— and what could act goes —scripts, forms and their controls, frames and embedded objects, event
// handlers, links to `javascript:`, and style rules that load or run something—. The viewer also paints it in an
// isolated frame without scripts and with its own content policy; this is the defense before that one. Remote images
// keep their address and are counted, so the viewer loads them only when the person asks.

// Kept with their content.
const ALLOWED = new Set([
  "a", "abbr", "address", "article", "b", "bdi", "bdo", "blockquote", "br", "caption", "center", "cite", "code", "col",
  "colgroup", "dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre", "q", "s",
  "samp", "section", "small", "span", "strike", "strong", "style", "sub", "sup", "table", "tbody", "td", "tfoot", "th",
  "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
]);
// Dropped with everything inside them.
const DROPPED_WITH_CONTENT = new Set([
  "script", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "button", "select",
  "textarea", "option", "optgroup", "datalist", "svg", "math", "canvas", "audio", "video", "portal", "title", "head",
]);
// Tags that carry nothing worth keeping and no content of their own: dropped alone (the content of `html` and `body` stays).
const VOID_DROPPED = new Set(["input", "link", "meta", "base", "source", "track", "param", "keygen", "area", "map"]);
const VOID = new Set(["br", "col", "hr", "img", "wbr"]);

const ATTRIBUTES = new Set([
  "align", "alt", "bgcolor", "border", "cellpadding", "cellspacing", "class", "color", "colspan", "dir", "face", "headers",
  "height", "href", "lang", "role", "rowspan", "scope", "size", "span", "src", "start", "style", "summary", "title",
  "type", "valign", "width",
]);

export type SanitizedMail = {
  html: string;
  // What was taken out, by kind, so a test and the viewer can say it.
  removed: { elements: number; handlers: number; links: number; styles: number };
  // Images whose address is on the network: the viewer loads them only when asked.
  remoteImages: number;
};

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

function safeLink(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

// An image's address: the network, a message's own part (`cid:`), or an inline picture; nothing that runs.
function safeImage(raw: string): { src: string; remote: boolean } | null {
  const value = raw.trim();
  if (/^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return { src: value, remote: false };
  if (/^cid:/i.test(value)) return { src: value, remote: false };
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? { src: url.href, remote: true } : null;
  } catch {
    return null;
  }
}

// A style that loads or runs something is dropped: imports, scripts in an address, old browsers' expressions and
// bindings. An address in a style (a background image) is dropped too: images load only through `img`, when asked.
const ACTIVE_PATTERN = /@import|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|url\s*\(|image-set\s*\(|image\s*\(/i;

// CSS reads `\75 rl(` and `u\rl(` as `url(`, and a comment between words as nothing: the test reads the style as the
// browser will, with its escapes decoded and its comments taken out.
function decodedCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    })
    .replace(/\\([^\r\n\f0-9a-f])/gi, "$1");
}

const ACTIVE_STYLE = { test: (css: string) => ACTIVE_PATTERN.test(decodedCss(css)) };

function cleanStyle(css: string): string | null {
  const rules = css
    .split(";")
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "");
  const kept = rules.filter((rule) => !ACTIVE_STYLE.test(rule));
  return kept.length === rules.length ? css : kept.length > 0 ? kept.join("; ") : null;
}

// A style sheet keeps its rules except those that load or run something.
function cleanSheet(css: string): { css: string; dropped: number } {
  let dropped = 0;
  const kept = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;/gi, () => {
      dropped++;
      return "";
    })
    .replace(/[^{}]+\{[^{}]*\}/g, (block) => {
      if (!ACTIVE_STYLE.test(block)) return block;
      dropped++;
      return "";
    })
    .replace(/<\/?style/gi, "");
  return { css: kept, dropped };
}

export function sanitizeMailHtml(input: string | null | undefined): SanitizedMail {
  const removed = { elements: 0, handlers: 0, links: 0, styles: 0 };
  let remoteImages = 0;
  if (!input) return { html: "", removed, remoteImages };
  let out = "";
  let skipping = 0;
  let inStyle = false;
  let sheet = "";
  // Each opened tag, and whether it was written, so its end closes only what was written.
  const stack: Array<{ name: string; written: boolean }> = [];

  const parser = new Parser(
    {
      onopentag(rawName, attrs) {
        const name = rawName.toLowerCase();
        if (skipping > 0) {
          if (DROPPED_WITH_CONTENT.has(name)) skipping++;
          stack.push({ name, written: false });
          return;
        }
        if (DROPPED_WITH_CONTENT.has(name)) {
          removed.elements++;
          skipping++;
          stack.push({ name, written: false });
          return;
        }
        if (!ALLOWED.has(name)) {
          if (VOID_DROPPED.has(name)) removed.elements++;
          stack.push({ name, written: false });
          return;
        }
        let written = `<${name}`;
        for (const [rawKey, value] of Object.entries(attrs)) {
          const key = rawKey.toLowerCase();
          if (key.startsWith("on")) {
            removed.handlers++;
            continue;
          }
          if (!ATTRIBUTES.has(key)) continue;
          if (key === "href") {
            const href = name === "a" ? safeLink(value) : null;
            if (!href) {
              removed.links++;
              continue;
            }
            written += ` href="${escapeAttr(href)}"`;
            continue;
          }
          if (key === "src") {
            const image = name === "img" ? safeImage(value) : null;
            if (!image) {
              removed.links++;
              continue;
            }
            if (image.remote) remoteImages++;
            written += ` src="${escapeAttr(image.src)}"`;
            continue;
          }
          if (key === "style") {
            const style = cleanStyle(value);
            if (style !== value) removed.styles++;
            if (style) written += ` style="${escapeAttr(style)}"`;
            continue;
          }
          written += ` ${key}="${escapeAttr(value)}"`;
        }
        // A link opens in a new tab and tells the destination nothing about where it came from.
        if (name === "a" && written.includes(" href=")) written += ' target="_blank" rel="noopener noreferrer"';
        out += `${written}>`;
        if (name === "style") {
          inStyle = true;
          sheet = "";
        }
        stack.push({ name, written: !VOID.has(name) });
      },
      ontext(text) {
        if (skipping > 0) return;
        if (inStyle) sheet += text;
        else out += escapeText(text);
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase();
        const at = stack.map((entry) => entry.name).lastIndexOf(name);
        if (at === -1) return;
        // Whatever the input left open inside it closes with it.
        while (stack.length > at) {
          const entry = stack.pop()!;
          if (DROPPED_WITH_CONTENT.has(entry.name) && skipping > 0) skipping--;
          if (!entry.written) continue;
          if (entry.name === "style") {
            const { css, dropped } = cleanSheet(sheet);
            removed.styles += dropped;
            // A style sheet is raw text: entities do not apply in it, and only a `<` could end it, so none is written.
            out += css.replace(/</g, "\\3C ");
            inStyle = false;
          }
          out += `</${entry.name}>`;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  );
  parser.write(input);
  parser.end();
  return { html: out, removed, remoteImages };
}
