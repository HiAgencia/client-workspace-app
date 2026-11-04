import { isRichHtml, safeHref, sanitizeRichText } from "./rich-text";

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function inlineLink(words: string, address: string): string {
  const text = words.trim().replace(/\[/g, "(").replace(/\]/g, ")");
  return `[${text}](${address.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

export type InlinePiece = { text: string; href: string | null };

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

export function inlineToHtml(value: string): string {
  return inlinePieces(value)
    .map((piece) => (piece.href ? `<a href="${escapeHtml(piece.href)}">${escapeHtml(piece.text)}</a>` : escapeHtml(piece.text)))
    .join("");
}

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

export function inlinePlain(value: string): string {
  return inlinePieces(value)
    .map((piece) => piece.text)
    .join("");
}
