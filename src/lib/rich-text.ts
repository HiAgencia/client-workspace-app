import { Parser } from "htmlparser2";

// Rich text is HTML from a closed list: paragraphs, bold, italic, lists, links (http, https, mailto), and a color taken
// from a fixed palette as a class the theme paints, never a `style`. The tool layer sanitizes what it writes —so the
// screen, the chat, and the MCP pass the same filter— and the screen sanitizes again what it paints. It runs without a
// DOM (the Worker has none), over a streaming parser.

export const TONES = ["red", "amber", "green", "blue", "violet"] as const;
export type Tone = (typeof TONES)[number];

const BLOCKS = new Set(["p", "ul", "ol", "li"]);
const INLINE = new Set(["strong", "em", "a", "span", "br"]);
const RENAME: Record<string, string> = { b: "strong", i: "em", div: "p", h1: "p", h2: "p", h3: "p", h4: "p", blockquote: "p" };
const SKIP_CONTENT = new Set(["script", "style", "template", "noscript", "iframe", "object", "svg", "math", "head", "title"]);

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

export function safeHref(raw: string): string | null {
  const value = raw.trim();
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

function toneOf(className: string | undefined): Tone | null {
  const match = className?.match(/(?:^|\s)tc-([a-z]+)(?:\s|$)/);
  return match && (TONES as readonly string[]).includes(match[1]) ? (match[1] as Tone) : null;
}

// Text with no tag at all is plain text (what the chat, an agent, or a one-line field writes): each line is a paragraph.
function plainToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeText(line)}</p>`)
    .join("");
}

// Whether a text is the closed list's HTML: it opens or closes one of its tags. Anything else —"a<b", "Vec<String>", a
// component's name in a coding agent's note— is plain text and stays whole.
const KNOWN_TAG = /<\/?(p|br|strong|b|em|i|ul|ol|li|a|span|div|h[1-4]|blockquote)(\s[^>]*)?\/?>/i;

export function isRichHtml(input: string): boolean {
  return KNOWN_TAG.test(input);
}

export function sanitizeRichText(input: string | null | undefined): string | null {
  if (input == null) return null;
  if (!isRichHtml(input)) input = plainToHtml(input);
  let out = "";
  // The open tags as written to the output, so every one closes in order whatever the input did.
  const open: string[] = [];
  // Tags of the input that wrote nothing (dropped or skipped), so their end does not close a written one.
  const pending: Array<string | null> = [];
  let skipping = 0;
  let implicit = false;

  const openImplicit = () => {
    if (!implicit && !open.some((tag) => BLOCKS.has(tag))) {
      out += "<p>";
      open.push("p");
      implicit = true;
    }
  };
  const closeImplicit = () => {
    if (!implicit) return;
    while (open.length > 0) {
      const tag = open.pop()!;
      out += `</${tag}>`;
      if (tag === "p") break;
    }
    implicit = false;
  };

  const parser = new Parser(
    {
      onopentag(rawName, attrs) {
        const name = RENAME[rawName] ?? rawName;
        if (skipping > 0 || SKIP_CONTENT.has(rawName)) {
          if (SKIP_CONTENT.has(rawName)) skipping++;
          pending.push(null);
          return;
        }
        if (BLOCKS.has(name)) {
          // A paragraph does not nest: a block inside one closes it first; an item lives in a list.
          if (name !== "li") closeImplicit();
          if (name === "p" && open.includes("p")) {
            while (open.length > 0 && open.at(-1) !== "li") {
              const tag = open.pop()!;
              out += `</${tag}>`;
              if (tag === "p") break;
            }
          }
          if (name === "li" && !open.some((tag) => tag === "ul" || tag === "ol")) {
            closeImplicit();
            out += "<ul>";
            open.push("ul");
          }
          out += `<${name}>`;
          open.push(name);
          pending.push(name);
          return;
        }
        if (!INLINE.has(name)) {
          pending.push(null);
          return;
        }
        openImplicit();
        if (name === "br") {
          out += "<br>";
          pending.push(null);
          return;
        }
        if (name === "a") {
          const href = safeHref(attrs.href ?? "");
          if (!href) {
            pending.push(null);
            return;
          }
          out += `<a href="${escapeAttr(href)}">`;
        } else if (name === "span") {
          const tone = toneOf(attrs.class);
          if (!tone) {
            pending.push(null);
            return;
          }
          out += `<span class="tc-${tone}">`;
        } else {
          out += `<${name}>`;
        }
        open.push(name);
        pending.push(name);
      },
      ontext(text) {
        if (skipping > 0 || text.length === 0) return;
        if (!open.some((tag) => BLOCKS.has(tag))) {
          if (text.trim() === "") return;
          openImplicit();
        }
        out += escapeText(text);
      },
      onclosetag(rawName, isImplied) {
        if (SKIP_CONTENT.has(rawName) && skipping > 0) {
          skipping--;
          pending.pop();
          return;
        }
        const written = pending.pop();
        if (!written || isImplied && written === "br") return;
        const at = open.lastIndexOf(written);
        if (at === -1) return;
        while (open.length > at) out += `</${open.pop()!}>`;
        if (!open.some((tag) => BLOCKS.has(tag))) implicit = false;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(input);
  parser.end();
  while (open.length > 0) out += `</${open.pop()!}>`;
  // An empty body is no body.
  const cleaned = out.replace(/<p>(\s|<br>)*<\/p>/g, "").trim();
  return cleaned === "" ? null : cleaned;
}

// The text a body reads as, one line per block: what search, the palette, and the lists read. With `links`, a link
// keeps its address over its words as a title holds it, `[words](address)`: what a note's title reads.
export function richTextToPlain(html: string | null | undefined, options: { links?: boolean } = {}): string {
  if (!html) return "";
  let text = "";
  let skipping = 0;
  // The address of each open link, or null for one that is not written as a link.
  const links: Array<string | null> = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (SKIP_CONTENT.has(name)) skipping++;
        if (name === "br") text += "\n";
        if ((name === "p" || name === "li" || name === "div") && text !== "" && !text.endsWith("\n")) text += "\n";
        if (name === "a") {
          const href = options.links && skipping === 0 ? safeHref(attrs.href ?? "") : null;
          links.push(href);
          if (href) text += "[";
        }
      },
      ontext(chunk) {
        if (skipping > 0) return;
        // Inside a link, brackets would end its words early.
        text += links.some(Boolean) ? chunk.replace(/\[/g, "(").replace(/\]/g, ")") : chunk;
      },
      onclosetag(name) {
        if (SKIP_CONTENT.has(name)) skipping = Math.max(0, skipping - 1);
        if (name === "a") {
          const href = links.pop();
          if (href) text += `](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

// The first line of a text, in plain words, bounded like any title.
export function firstLine(html: string | null | undefined, max = 500): string {
  const line = richTextToPlain(html).split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// A note's title: the first line of its text, its links kept over their words as `[words](address)`. A line too long for
// a title keeps its words and drops its addresses rather than cutting one in half.
export function noteTitle(html: string | null | undefined, max = 500): string {
  const line = richTextToPlain(html, { links: true }).split("\n")[0] ?? "";
  return line.length > max ? firstLine(html, max) : line;
}
