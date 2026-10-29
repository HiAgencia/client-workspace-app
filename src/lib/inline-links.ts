import { isRichHtml, safeHref, sanitizeRichText } from "./rich-text";

// A link over words, as a title or a one-line note keeps it: `[words](address)`. The text stores it as written and the
// screen paints it; text without that shape is plain text and stays whole. The migration that turned the links into notes
// writes the same shape (20261031010000).

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

// Brackets inside the words and parentheses inside the address would end the link early: the words trade their brackets
// for parentheses, and the address writes its parentheses percent-encoded.
export function inlineLink(words: string, address: string): string {
  const text = words.trim().replace(/\[/g, "(").replace(/\]/g, ")");
  return `[${text}](${address.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

export type InlinePiece = { text: string; href: string | null };

// The pieces of a text: plain runs and links. An address outside http, https, or mailto stays as the text it was.
export function inlinePieces(value: string): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  let last = 0;
  for (const match of value.matchAll(LINK)) {
    const href = safeHref(match[2]);
    if (!href) continue;
    if (match.index > last) pieces.push({ text: value.slice(last, match.index), href: null });
    pieces.push({ text: match[1], href });
    last = match.index + match[0].length;
  }
  if (last < value.length) pieces.push({ text: value.slice(last), href: null });
  return pieces;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A one-line text as rich text: its links over their words become links the editor shows.
export function inlineToHtml(value: string): string {
  return inlinePieces(value)
    .map((piece) => (piece.href ? `<a href="${escapeHtml(piece.href)}">${escapeHtml(piece.text)}</a>` : escapeHtml(piece.text)))
    .join("");
}

// What a body keeps of a text someone wrote: the closed list's HTML as it comes, or plain text a paragraph per line with
// its `[words](address)` turned into links, so the editor never shows the brackets.
export function writtenBody(input: string | null | undefined): string | null {
  if (input == null) return null;
  if (isRichHtml(input) || !/\[[^\]\n]+\]\([^)\s]+\)/.test(input)) return sanitizeRichText(input);
  return sanitizeRichText(
    input
      .split(/\r?\n/)
      .map((line) => `<p>${inlineToHtml(line)}</p>`)
      .join(""),
  );
}

// What a text reads as without its addresses: what search and the palette compare.
export function inlinePlain(value: string): string {
  return inlinePieces(value)
    .map((piece) => piece.text)
    .join("");
}
