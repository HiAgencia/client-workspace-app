





const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[^\s@]+@[^\s@]+\.[^\s@]+)/i;


const FIRST_WORD = /^[^\s<&[\]()]*/u;

function capitalAt(text: string, index: number): string {
  const rest = text.slice(index);
  if (ADDRESS.test(rest)) return text;
  const letter = String.fromCodePoint(text.codePointAt(index)!);
  if (/\p{Lu}/u.test(FIRST_WORD.exec(rest)![0].slice(letter.length))) return text;
  const capital = letter.toUpperCase();
  
  if (capital === letter || [...capital].length !== 1) return text;
  return text.slice(0, index) + capital + text.slice(index + letter.length);
}


export function withInitialCapital(text: string): string {
  for (let index = 0; index < text.length; ) {
    const letter = String.fromCodePoint(text.codePointAt(index)!);
    if (/\p{L}/u.test(letter)) return capitalAt(text, index);
    if (/\p{N}/u.test(letter)) return text;
    index += letter.length;
  }
  return text;
}



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
