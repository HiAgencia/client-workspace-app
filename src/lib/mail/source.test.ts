import { describe, expect, it } from "vitest";
import { folded, holdsEveryWord, waitWords } from "./source";

// Whether a message is a possible reply to what a task waits for, read from the piece it is handed: each control below
// has a twin, a broken version of that piece, which must fail it with the control's own words.

type Holds = typeof holdsEveryWord;

const APPROVAL = { from: { name: "Developer Platform", email: "noreply@developers.example" }, subject: "Your app review was approved" };

function inNameAddressOrSubject(holds: Holds) {
  expect(holds(APPROVAL, ["platform"]), "a word of the sender's name is enough").toBe(true);
  expect(holds(APPROVAL, ["developers.example"]), "a word of the sender's address is enough").toBe(true);
  expect(holds(APPROVAL, ["approved"]), "a word of the subject is enough").toBe(true);
}

function everyWord(holds: Holds) {
  expect(holds(APPROVAL, ["developer", "approved"]), "words spread over the sender and the subject all count").toBe(true);
  expect(holds(APPROVAL, ["developer", "invoice"]), "every word is needed: one missing is no reply").toBe(false);
}

function noCapitals(holds: Holds) {
  expect(holds(APPROVAL, ["DEVELOPER", "Review"]), "capitals aside").toBe(true);
}

function noAccents(holds: Holds) {
  const message = { from: { name: "Revisión de apps", email: "apps@example.com" }, subject: "Aprobacion de la cuenta" };
  expect(holds(message, ["revision", "aprobación"]), "accents aside, on either side").toBe(true);
}

function noWordNoReply(holds: Holds) {
  expect(holds(APPROVAL, []), "a wait with no word takes no message").toBe(false);
}

// Gmail reads a word whole: the sample accounts must not find what a real account would not.
function wholeWords(holds: Holds) {
  expect(holds(APPROVAL, ["dev"]), "a word is whole, as Gmail reads it: part of a longer one is no reply").toBe(false);
  expect(holds(APPROVAL, ["approve"]), "a word is whole, as Gmail reads it: part of a longer one is no reply").toBe(false);
  expect(holds(APPROVAL, ["review"]), "a whole word between others still counts").toBe(true);
}

// A script written without spaces has no whole word to cut at a space.
function unspacedScripts(holds: Holds) {
  const message = { from: { name: "総務部", email: "soumu@example.jp" }, subject: "会議室のご案内" };
  expect(holds(message, ["会議"]), "a word of a script written without spaces is found inside a longer run").toBe(true);
}

// A letter outside the basic plane takes two code units, and right before a word it still makes the word part of a longer one.
function wholeAcrossPlanes(holds: Holds) {
  const message = { from: { name: "Ops", email: "ops@example.com" }, subject: "𝐀pproved today" };
  expect(holds(message, ["pproved"]), "a letter outside the basic plane before a word makes it part of a longer one").toBe(false);
}

// A twin: the control, handed a broken piece, fails with its own words.
function failsWith(control: (holds: Holds) => void, broken: Holds, phrase: string) {
  let failure: unknown = null;
  try {
    control(broken);
  } catch (error) {
    failure = error;
  }
  expect(failure, `the twin fails «${phrase}»`).not.toBeNull();
  expect(String((failure as Error).message)).toContain(phrase);
}

const fieldsOf = (message: Parameters<Holds>[0], parts: Array<"name" | "address" | "subject">) =>
  parts.map((part) => (part === "name" ? (message.from.name ?? "") : part === "address" ? message.from.email : message.subject)).join("\n");

describe("a possible reply to what a task waits for", () => {
  it("holds every word whole in the sender's name or address or in the subject, accents and capitals aside", () => {
    inNameAddressOrSubject(holdsEveryWord);
    everyWord(holdsEveryWord);
    noCapitals(holdsEveryWord);
    noAccents(holdsEveryWord);
    noWordNoReply(holdsEveryWord);
    wholeWords(holdsEveryWord);
    unspacedScripts(holdsEveryWord);
    wholeAcrossPlanes(holdsEveryWord);
  });

  it("its twins: each broken piece fails its own control", () => {
    const withoutAddress: Holds = (message, words) => words.length > 0 && words.every((word) => folded(fieldsOf(message, ["name", "subject"])).includes(folded(word)));
    failsWith(inNameAddressOrSubject, withoutAddress, "a word of the sender's address is enough");
    const anyWord: Holds = (message, words) => words.some((word) => folded(fieldsOf(message, ["name", "address", "subject"])).includes(folded(word)));
    failsWith(everyWord, anyWord, "every word is needed: one missing is no reply");
    const withCapitals: Holds = (message, words) =>
      words.length > 0 && words.every((word) => fieldsOf(message, ["name", "address", "subject"]).normalize("NFD").replace(/\p{M}/gu, "").includes(word.normalize("NFD").replace(/\p{M}/gu, "")));
    failsWith(noCapitals, withCapitals, "capitals aside");
    const withAccents: Holds = (message, words) => words.length > 0 && words.every((word) => fieldsOf(message, ["name", "address", "subject"]).toLowerCase().includes(word.toLowerCase()));
    failsWith(noAccents, withAccents, "accents aside, on either side");
    const everyMessage: Holds = (message, words) => words.every((word) => folded(fieldsOf(message, ["name", "address", "subject"])).includes(folded(word)));
    failsWith(noWordNoReply, everyMessage, "a wait with no word takes no message");
    const anyPart: Holds = (message, words) => words.length > 0 && words.every((word) => folded(fieldsOf(message, ["name", "address", "subject"])).includes(folded(word)));
    failsWith(wholeWords, anyPart, "a word is whole, as Gmail reads it");
    // Whole words read by code units and for every script alike.
    const wholeByUnits = (text: string, word: string) => {
      for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
        if (!/[\p{L}\p{N}]/u.test(text[at - 1] ?? "") && !/[\p{L}\p{N}]/u.test(text[at + word.length] ?? "")) return true;
      }
      return false;
    };
    const byUnits: Holds = (message, words) => words.length > 0 && words.every((word) => wholeByUnits(folded(fieldsOf(message, ["name", "address", "subject"])), folded(word)));
    failsWith(unspacedScripts, byUnits, "a word of a script written without spaces is found inside a longer run");
    failsWith(wholeAcrossPlanes, byUnits, "a letter outside the basic plane before a word makes it part of a longer one");
  });

  it("reads a wait's words cleaned of what a search would take for its own", () => {
    expect(waitWords("  Meta   app-review ")).toEqual(["Meta", "app-review"]);
    expect(waitWords('from:"Bayside Bank" (OR) -draft +exact {x}')).toEqual(["fromBayside", "Bank", "OR", "draft", "exact", "x"]);
    expect(waitWords("-- () . @")).toEqual([]);
  });
});
