// What a person types in quick add, read into a task: a day and an hour in plain words («tomorrow 4pm», «next friday»,
// «in 3 days», «oct 30»), a place after «#» («#Website»), and a priority from «p1» (urgent) to «p4» (low). Every piece
// keeps where it sits in the text, so the field marks it and a chip repeats it; what is not read stays in the title as
// typed. A link written over words (`[words](url)`) is never read into a piece, and a piece the person dismissed is read
// as plain words from then on.

import { addDays, addMonths, type Day } from "./dates";
import { normalize } from "./fuzzy";

export type QuickAddPlace = { id: string; name: string; path: string };
export type Priority = 1 | 2 | 3 | 4;
export type PieceKind = "date" | "place" | "priority";

export type QuickAddPiece = { kind: PieceKind; start: number; end: number; text: string };

export type QuickAddReading = {
  title: string;
  day: Day | null;
  // "HH:MM" on a 24-hour clock; there is a time only with a day.
  time: string | null;
  place: QuickAddPlace | null;
  // Several places answer to what was typed after «#»: the person picks one.
  placeCandidates: QuickAddPlace[];
  // «#» followed by words no place answers to.
  unknownPlace: string | null;
  priority: Priority | null;
  pieces: QuickAddPiece[];
};

export type QuickAddOptions = {
  today: Day;
  // The person's "HH:MM" now: an hour written alone that has already passed today is tomorrow's.
  clock?: string;
  places: QuickAddPlace[];
  // Pieces the person took back to plain words, by kind and text: the same words are not read again.
  dismissed?: Array<{ kind: PieceKind; text: string }>;
};

type Span = { start: number; end: number };
// A weak day is read only beside an hour.
type Found = Span & { day?: Day; time?: string; priority?: Priority; weak?: boolean };

const START = "(?<![\\p{L}\\p{N}])";
// A word ends where no letter, digit, or apostrophe follows, so «Friday's meeting» stays words.
const END = "(?![\\p{L}\\p{N}'’])";
const LEAD = "(?:(?:on|at|by)\\s+)?";

const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(sunday|sun)$/, 0],
  [/^(monday|mon)$/, 1],
  [/^(tuesday|tues|tue)$/, 2],
  [/^(wednesday|wed)$/, 3],
  [/^(thursday|thurs|thur|thu)$/, 4],
  [/^(friday|fri)$/, 5],
  [/^(saturday|sat)$/, 6],
];
const WEEKDAY_WORDS = "sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat";
// Short weekdays that are also words («the sun banner», «sat on it», «to wed») read as a day only after «on», «by», or
// «next», or beside an hour: «brunch sun 11am» is Sunday, «Fix the sun banner» stays words.
const WORDLIKE_WEEKDAYS = new Set(["sun", "mon", "wed", "sat"]);

const MONTHS: Array<[RegExp, number]> = [
  [/^jan(uary)?$/, 1],
  [/^feb(ruary)?$/, 2],
  [/^mar(ch)?$/, 3],
  [/^apr(il)?$/, 4],
  [/^may$/, 5],
  [/^june?$/, 6],
  [/^july?$/, 7],
  [/^aug(ust)?$/, 8],
  [/^sep(t|tember)?$/, 9],
  [/^oct(ober)?$/, 10],
  [/^nov(ember)?$/, 11],
  [/^dec(ember)?$/, 12],
];
const MONTH_WORDS =
  "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec";

const COUNTS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const pad = (n: number) => String(n).padStart(2, "0");

function weekdayOf(day: Day): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function weekdayNumber(word: string): number {
  return WEEKDAYS.find(([pattern]) => pattern.test(word))?.[1] ?? -1;
}

function monthNumber(word: string): number {
  return MONTHS.find(([pattern]) => pattern.test(word.replace(/\.$/, "")))?.[1] ?? -1;
}

// The first occurrence of a weekday after today; «next» takes it into the following week when it falls in this one
// (weeks start on Monday), so on a Wednesday «friday» is in two days and «next friday» in nine.
function weekdayAfter(today: Day, weekday: number, next: boolean): Day {
  const now = weekdayOf(today);
  let ahead = (weekday - now + 7) % 7;
  if (ahead === 0) ahead = 7;
  if (next) {
    const toSunday = (7 - now) % 7;
    if (ahead <= toSunday) ahead += 7;
  }
  return addDays(today, ahead);
}

// A day of a month that has passed this year is next year's.
function monthDay(today: Day, month: number, day: number): Day | null {
  let year = Number(today.slice(0, 4));
  const last = new Date(year, month, 0).getDate();
  if (day < 1 || day > last) return null;
  let candidate = `${year}-${pad(month)}-${pad(day)}`;
  if (candidate < today) {
    year += 1;
    if (day > new Date(year, month, 0).getDate()) return null;
    candidate = `${year}-${pad(month)}-${pad(day)}`;
  }
  return candidate;
}

function nextMonday(today: Day): Day {
  return weekdayAfter(today, 1, false);
}

function findAll(text: string, pattern: RegExp, read: (match: RegExpExecArray) => Omit<Found, "start" | "end"> | null): Found[] {
  const found: Found[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = read(match as RegExpExecArray);
    if (value) found.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, ...value });
  }
  return found;
}

function days(text: string, today: Day): Found[] {
  const flags = "giu";
  return [
    ...findAll(text, new RegExp(`${START}${LEAD}today${END}`, flags), () => ({ day: today })),
    ...findAll(text, new RegExp(`${START}${LEAD}(?:tomorrow|tmrw)${END}`, flags), () => ({ day: addDays(today, 1) })),
    ...findAll(text, new RegExp(`${START}${LEAD}next\\s+week${END}`, flags), () => ({ day: nextMonday(today) })),
    ...findAll(text, new RegExp(`${START}(?:(on|at|by)\\s+)?(next\\s+)?(${WEEKDAY_WORDS})${END}`, flags), (m) => {
      const word = m[3].toLowerCase();
      const weekday = weekdayNumber(word);
      if (weekday < 0) return null;
      const weak = WORDLIKE_WEEKDAYS.has(word) && !m[2] && !/^(on|by)$/i.test(m[1] ?? "");
      return { day: weekdayAfter(today, weekday, Boolean(m[2])), weak };
    }),
    ...findAll(
      text,
      new RegExp(`${START}in\\s+(\\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(days?|weeks?|months?)${END}`, flags),
      (m) => {
        const raw = m[1].toLowerCase();
        const count = /^\d+$/.test(raw) ? Number(raw) : COUNTS[raw];
        if (!count) return null;
        const unit = m[2].toLowerCase();
        if (unit.startsWith("day")) return { day: addDays(today, count) };
        if (unit.startsWith("week")) return { day: addDays(today, 7 * count) };
        return { day: addMonths(today, count) };
      },
    ),
    ...findAll(text, new RegExp(`${START}${LEAD}(${MONTH_WORDS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${END}`, flags), (m) => {
      const day = monthDay(today, monthNumber(m[1].toLowerCase()), Number(m[2]));
      return day ? { day } : null;
    }),
    ...findAll(text, new RegExp(`${START}${LEAD}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORDS})${END}`, flags), (m) => {
      const day = monthDay(today, monthNumber(m[2].toLowerCase()), Number(m[1]));
      return day ? { day } : null;
    }),
  ];
}

function times(text: string): Found[] {
  const flags = "giu";
  return [
    ...findAll(text, new RegExp(`${START}(?:at\\s+)?(\\d{1,2})(?::([0-5]\\d))?\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![\\p{L}\\p{N}])`, flags), (m) => {
      const hour = Number(m[1]);
      if (hour < 1 || hour > 12) return null;
      const pm = m[3].toLowerCase().startsWith("p");
      const h24 = (hour % 12) + (pm ? 12 : 0);
      return { time: `${pad(h24)}:${m[2] ?? "00"}` };
    }),
    ...findAll(text, new RegExp(`${START}(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)${END}`, flags), (m) => ({
      time: `${pad(Number(m[1]))}:${m[2]}`,
    })),
    ...findAll(text, new RegExp(`${START}(?:at\\s+)?noon${END}`, flags), () => ({ time: "12:00" })),
  ];
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

// The spans of links written over words: nothing inside them is read.
function linkSpans(text: string): Span[] {
  return [...text.matchAll(/\[[^\]\n]*\]\([^)\s]*\)/g)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

// Keeps the longest of the matches that overlap, then the earliest.
function separate(found: Found[]): Found[] {
  const sorted = [...found].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Found[] = [];
  for (const candidate of sorted) if (!kept.some((other) => overlaps(other, candidate))) kept.push(candidate);
  return kept.sort((a, b) => a.start - b.start);
}

// A piece the person dismissed covers the words it held: a dismissed «tomorrow 4pm» leaves both «tomorrow» and «4pm» as
// words, while a dismissed «friday» still lets an hour typed after it be read on its own.
function isDismissed(options: QuickAddOptions, kind: PieceKind, text: string): boolean {
  const typed = normalize(text.trim());
  return (options.dismissed ?? []).some((piece) => piece.kind === kind && normalize(piece.text.trim()).includes(typed));
}

// The words between two spans, whichever comes first; overlapping spans have none.
function between(text: string, a: Span, b: Span): string | null {
  if (a.end <= b.start) return text.slice(a.end, b.start);
  if (b.end <= a.start) return text.slice(b.end, a.start);
  return null;
}

type PlaceHit = Span & { place: QuickAddPlace | null; candidates: QuickAddPlace[] };

// «#» followed by the longest path or name of a place, whole: «#Website» or «#Larkspur Bakery / Website». A name more
// than one place carries is offered as candidates instead of picking one.
function places(text: string, options: QuickAddOptions, blocked: Span[]): { hits: PlaceHit[]; unknown: string | null } {
  const hits: PlaceHit[] = [];
  let unknown: string | null = null;
  for (const match of text.matchAll(/(?<![\p{L}\p{N}])#/gu)) {
    const at = match.index ?? 0;
    if (blocked.some((span) => at >= span.start && at < span.end)) continue;
    const rest = text.slice(at + 1);
    let best = 0;
    let winners: QuickAddPlace[] = [];
    for (const place of options.places) {
      for (const label of [place.path, place.name]) {
        if (!label || label.length > rest.length) continue;
        if (normalize(rest.slice(0, label.length)) !== normalize(label)) continue;
        const after = rest.charAt(label.length);
        if (after && /[\p{L}\p{N}]/u.test(after)) continue;
        if (label.length > best) {
          best = label.length;
          winners = [place];
        } else if (label.length === best && !winners.some((w) => w.id === place.id)) {
          winners.push(place);
        }
      }
    }
    const span = { start: at, end: at + 1 + best };
    if (best > 0 && !isDismissed(options, "place", text.slice(span.start, span.end))) {
      hits.push({ ...span, place: winners.length === 1 ? winners[0] : null, candidates: winners.length > 1 ? winners : [] });
    } else if (best === 0) {
      const word = /^[\p{L}\p{N}][^\s#]*/u.exec(rest)?.[0];
      if (word) unknown = word;
    }
  }
  return { hits, unknown };
}

export function readQuickAdd(text: string, options: QuickAddOptions): QuickAddReading {
  const links = linkSpans(text);
  const placeRead = places(text, options, links);
  const lastPlace = placeRead.hits.at(-1) ?? null;
  const blocked = [...links, ...placeRead.hits];
  const free = (span: Span) => !blocked.some((other) => overlaps(other, span));

  const dayHits = separate(days(text, options.today).filter(free)).filter((hit) => !isDismissed(options, "date", text.slice(hit.start, hit.end)));
  const timeHits = separate(times(text).filter(free))
    .filter((hit) => !dayHits.some((day) => overlaps(day, hit)))
    .filter((hit) => !isDismissed(options, "date", text.slice(hit.start, hit.end)));

  // A day and an hour written next to each other read as one piece: «tomorrow 4pm», «4pm tomorrow», «friday at 16:00».
  const groups: Array<Found> = [];
  const used = new Set<Found>();
  for (const day of dayHits) {
    const time = timeHits.find((hit) => {
      const gap = between(text, day, hit);
      return !used.has(hit) && gap !== null && /^\s*$/.test(gap);
    });
    if (time) {
      used.add(time);
      groups.push({ start: Math.min(day.start, time.start), end: Math.max(day.end, time.end), day: day.day, time: time.time });
    } else if (!day.weak) {
      groups.push(day);
    }
  }
  const tomorrow = addDays(options.today, 1);
  for (const time of timeHits) {
    if (used.has(time)) continue;
    const passed = options.clock !== undefined && time.time !== undefined && time.time < options.clock;
    groups.push({ ...time, day: passed ? tomorrow : options.today });
  }
  groups.sort((a, b) => a.start - b.start);
  // The last date written is the task's; one written before it stays in the title as words.
  const date = groups.at(-1) ?? null;

  const priorityHits = findAll(text, /(?<![\p{L}\p{N}])p([1-4])(?![\p{L}\p{N}])/giu, (m) => ({ priority: Number(m[1]) as Priority }))
    .filter(free)
    .filter((hit) => !(date && overlaps(date, hit)))
    .filter((hit) => !isDismissed(options, "priority", text.slice(hit.start, hit.end)));
  const priorityHit = priorityHits.at(-1) ?? null;

  const pieces: QuickAddPiece[] = [];
  if (date) pieces.push({ kind: "date", start: date.start, end: date.end, text: text.slice(date.start, date.end) });
  if (lastPlace) pieces.push({ kind: "place", start: lastPlace.start, end: lastPlace.end, text: text.slice(lastPlace.start, lastPlace.end) });
  if (priorityHit) {
    pieces.push({ kind: "priority", start: priorityHit.start, end: priorityHit.end, text: text.slice(priorityHit.start, priorityHit.end) });
  }
  pieces.sort((a, b) => a.start - b.start);

  let title = "";
  let cursor = 0;
  for (const piece of pieces) {
    title += text.slice(cursor, piece.start);
    cursor = piece.end;
  }
  title += text.slice(cursor);

  return {
    title: title.replace(/\s+/g, " ").trim(),
    day: date?.day ?? null,
    time: date?.time ?? null,
    place: lastPlace?.place ?? null,
    placeCandidates: lastPlace?.candidates ?? [],
    unknownPlace: placeRead.unknown,
    priority: priorityHit?.priority ?? null,
    pieces,
  };
}
