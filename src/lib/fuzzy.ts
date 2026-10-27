// Search that forgives typing: accents and case ignored (a letter the language treats as its own, like «ñ», stays),
// punctuation as a separator, words in any order, and each word allowed a few typos by its length — a swapped pair of
// letters counts as one.

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0000/g, "ñ");
}

export function words(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Optimal string alignment distance (Damerau–Levenshtein without repeated edits), stopping once past `max`.
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

// How many typos a typed word may carry: none in a short one, where one typo already reaches other words.
export function allowedTypos(word: string): number {
  if (word.length <= 3) return 0;
  if (word.length <= 6) return 1;
  return 2;
}

// How well one typed word matches one word of the text, from 1 (the same) to 0 (no match).
export function wordScore(typed: string, word: string): number {
  if (word === typed) return 1;
  if (word.startsWith(typed)) return 0.92;
  if (typed.length >= 3 && word.includes(typed)) return 0.75;
  const allowed = allowedTypos(typed);
  if (allowed === 0) return 0;
  // A word still being typed is compared with the start of the longer one, so "nortw" finds "northwind".
  const whole = editDistance(typed, word, allowed);
  const start = word.length > typed.length ? editDistance(typed, word.slice(0, typed.length), allowed) : whole;
  const distance = Math.min(whole, start);
  return distance <= allowed ? 0.65 - 0.12 * distance : 0;
}

// A text matches when every typed word matches one of its words; the score is their mean, with a little more for a
// text that starts as typed.
export function matchScore(query: string, text: string): number {
  const typed = words(query);
  if (typed.length === 0) return 0;
  const target = words(text);
  if (target.length === 0) return 0;
  let total = 0;
  for (const word of typed) {
    let best = 0;
    for (const candidate of target) best = Math.max(best, wordScore(word, candidate));
    if (best === 0) return 0;
    total += best;
  }
  const startsAsTyped = normalize(text).startsWith(normalize(query).trim()) ? 0.1 : 0;
  return total / typed.length + startsAsTyped;
}

export function rank<T>(query: string, entries: T[], text: (entry: T) => string): Array<{ entry: T; score: number }> {
  return entries
    .map((entry) => ({ entry, score: matchScore(query, text(entry)) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
}
