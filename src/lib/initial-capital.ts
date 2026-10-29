// A name or a title someone writes is kept with its initial capital, whoever writes it —a screen, the chat, an agent—, so
// everything that shows it reads right. Only the first letter changes: the marks that open the text (a link's `[`, `¿`,
// a quote) are skipped, and a text that opens with a number or an address is left as it is. A first word that already
// carries a capital after its first letter is a brand written that way on purpose —«iOS», «eBay», «macOS»— and stays as
// it was written.

const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[^\s@]+@[^\s@]+\.[^\s@]+)/i;
// One or more lower-case letters followed by a capital, at the word's own start: a brand, not a loose text in lower case.
const BRAND = /^\p{Ll}+\p{Lu}/u;

function capitalAt(text: string, index: number): string {
  const rest = text.slice(index);
  if (ADDRESS.test(rest) || BRAND.test(rest)) return text;
  const letter = String.fromCodePoint(text.codePointAt(index)!);
  const capital = letter.toUpperCase();
  // A letter whose capital is more than one letter (ß) is left alone: only the first letter may change.
  if (capital === letter || [...capital].length !== 1) return text;
  return text.slice(0, index) + capital + text.slice(index + letter.length);
}

// A plain title or name: the first letter, past the marks that open it.
export function withInitialCapital(text: string): string {
  for (let index = 0; index < text.length; ) {
    const letter = String.fromCodePoint(text.codePointAt(index)!);
    if (/\p{L}/u.test(letter)) return capitalAt(text, index);
    if (/\p{N}/u.test(letter)) return text;
    index += letter.length;
  }
  return text;
}

// A body of the closed list of rich text, whose first line is a note's title: the first letter of its text, past its tags
// and its entities, which stay as they are.
export function withInitialCapitalHtml(html: string): string {
  for (let index = 0; index < html.length; ) {
    const char = html[index];
    if (char === "<") {
      const end = html.indexOf(">", index);
      if (end < 0) return html;
      index = end + 1;
      continue;
    }
    if (char === "&") {
      const entity = /^&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.exec(html.slice(index));
      if (entity) {
        index += entity[0].length;
        continue;
      }
    }
    const letter = String.fromCodePoint(html.codePointAt(index)!);
    if (/\p{L}/u.test(letter)) return capitalAt(html, index);
    if (/\p{N}/u.test(letter)) return html;
    index += letter.length;
  }
  return html;
}
