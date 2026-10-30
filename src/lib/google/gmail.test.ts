import { describe, expect, it } from "vitest";
import { splitBatch, type GmailMessage } from "./api";
import { addressList, bodiesOf, candidatesSearch, decodeWords, parseAddress, searchFrom, snippetText, toMailMessage, wordsSearch } from "./gmail";

const encode = (text: string, charset: BufferEncoding = "utf8") => Buffer.from(text, charset).toString("base64url");

// What a wait's search must keep, read from the search it is handed: each word in a group of its own of the sender and
// the subject, with nothing of Gmail's own search reaching past it, and no capital that could be one of its operators.
const SINCE = "2026-10-29T00:00:00Z";
const AFTER = `after:${Date.parse(SINCE) / 1000}`;
const ARRIVED = "-in:sent -in:draft -in:chats -in:spam -in:trash";
const HOSTILE = 'in:anywhere) OR {label:x} -(draft) "app review" AND +exact';

function groupsOf(search: typeof candidatesSearch): string {
  const q = search([HOSTILE], SINCE);
  expect(q.startsWith(`${ARRIVED} `) && q.endsWith(` ${AFTER}`), "the search keeps what arrived since the wait began").toBe(true);
  return q.slice(ARRIVED.length + 1, -(AFTER.length + 1));
}

function everyWordInItsGroup(search: typeof candidatesSearch) {
  const groups = groupsOf(search);
  const form = String.raw`(?:from|subject):[\p{L}\p{N}@._-]+`;
  expect(new RegExp(String.raw`^\(${form}(?: OR ${form})*\)(?: \(${form}(?: OR ${form})*\))*$`, "u").test(groups), "every word stays inside a group of its own").toBe(true);
}

function noOperatorCapitals(search: typeof candidatesSearch) {
  const values = groupsOf(search).replace(/\b(?:from|subject):/g, "").replace(/ OR /g, " ");
  expect(/\p{Lu}/u.test(values), "no capital of a word reaches Gmail, where it could read as an operator").toBe(false);
}

// A twin: the control, handed a broken search, fails with its own words.
function failsWith(control: () => void, phrase: string) {
  let failure: unknown = null;
  try {
    control();
  } catch (error) {
    failure = error;
  }
  expect(failure, `the twin fails «${phrase}»`).not.toBeNull();
  expect(String((failure as Error).message)).toContain(phrase);
}

describe("reading a Gmail message", () => {
  it("decodes a header's encoded words, and leaves a plain one as it is", () => {
    expect(decodeWords("=?UTF-8?B?Q2Fmw6k=?= meeting")).toBe("Café meeting");
    expect(decodeWords("=?ISO-8859-1?Q?Caf=E9_con_leche?=")).toBe("Café con leche");
    // Two encoded words in a row join without the space between them.
    expect(decodeWords("=?UTF-8?Q?Ma?= =?UTF-8?Q?=C3=B1ana?=")).toBe("Mañana");
    expect(decodeWords("Already decoded: Café")).toBe("Already decoded: Café");
    // A character whose bytes a mailer split between two words, in Q and in B.
    expect(decodeWords("=?UTF-8?Q?Ma=C3?= =?UTF-8?Q?=B1ana?=")).toBe("Mañana");
    expect(decodeWords(`=?UTF-8?B?${Buffer.from([0x43, 0x61, 0x66, 0xc3]).toString("base64")}?= =?UTF-8?B?${Buffer.from([0xa9]).toString("base64")}?=`)).toBe("Café");
    // Words in two charsets each decode in their own; one that is not valid stays as it came.
    expect(decodeWords("=?ISO-8859-1?Q?Caf=E9?= =?UTF-8?Q?_y_m=C3=A1s?=")).toBe("Café y más");
    expect(decodeWords("=?UTF-8?B?@@@?= ok")).toBe("=?UTF-8?B?@@@?= ok");
  });

  it("reads a sender with and without a name, and a list of recipients", () => {
    expect(parseAddress('"Maya Chen" <Maya@Larkspur.example>')).toEqual({ name: "Maya Chen", email: "maya@larkspur.example" });
    expect(parseAddress("Ana Ruiz <ana@studioatlas.example>")).toEqual({ name: "Ana Ruiz", email: "ana@studioatlas.example" });
    expect(parseAddress("noreply@developers.example")).toEqual({ name: null, email: "noreply@developers.example" });
    expect(parseAddress("=?UTF-8?B?Sm9zw6k=?= <jose@example.com>")).toEqual({ name: "José", email: "jose@example.com" });
    expect(parseAddress(null)).toEqual({ name: null, email: "" });
    // A comma inside a quoted name does not split it.
    expect(addressList('A <a@x.example>, "B, Jr." <b@x.example>, c@x.example')).toEqual(["a@x.example", "b@x.example", "c@x.example"]);
  });

  it("shows the snippet as text", () => {
    expect(snippetText("Don&#39;t &amp; won&#x27;t &lt;stop&gt;")).toBe("Don't & won't <stop>");
    expect(snippetText(undefined)).toBe("");
  });

  it("finds the HTML and the text in nested parts, each in its charset, and leaves attachments out", () => {
    const { html, text } = bodiesOf({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }], body: { data: encode("Mañana a las 4") } },
            { mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=ISO-8859-1" }], body: { data: encode("<p>Mañana</p>", "latin1") } },
          ],
        },
        { mimeType: "text/plain", filename: "notes.txt", body: { data: encode("an attachment") } },
      ],
    });
    expect(text).toBe("Mañana a las 4");
    expect(html).toBe("<p>Mañana</p>");
    expect(bodiesOf({ mimeType: "text/plain", body: { data: encode("only text") } })).toEqual({ html: null, text: "only text" });
  });

  it("throws on a body that is not base64, so its reader counts that message apart", () => {
    expect(() => bodiesOf({ mimeType: "text/plain", body: { data: "@@@" } })).toThrow();
  });

  it("looks for what a task waits for word by word, each in the sender or the subject, since the wait began", () => {
    expect(candidatesSearch(["Developer Platform"], SINCE)).toBe(`${ARRIVED} (from:developer OR subject:developer) (from:platform OR subject:platform) ${AFTER}`);
    // An address is one word; a word with accents is looked for with and without them.
    expect(candidatesSearch(["noreply@developers.example"], SINCE)).toBe(`${ARRIVED} (from:noreply@developers.example OR subject:noreply@developers.example) ${AFTER}`);
    expect(candidatesSearch(["Aprobación"], SINCE)).toBe(`${ARRIVED} (from:aprobación OR subject:aprobación OR from:aprobacion OR subject:aprobacion) ${AFTER}`);
    // Words with nothing left to look for search nothing, rather than everything that arrived.
    expect(candidatesSearch(["() -- {}"], SINCE)).toBe("");
  });

  it("keeps every word of a wait inside its own group, whatever the person writes", () => {
    everyWordInItsGroup(candidatesSearch);
    noOperatorCapitals(candidatesSearch);
  });

  it("its twins: a search that passes the words as they came, or with their capitals, fails each control", () => {
    const raw: typeof candidatesSearch = (words, since) => searchFrom(`${ARRIVED} (${words.join(" ")})`, since);
    failsWith(() => everyWordInItsGroup(raw), "every word stays inside a group of its own");
    const capitals: typeof candidatesSearch = (words, since) =>
      searchFrom(`${ARRIVED} ${words.join(" ").replace(/[^\p{L}\p{N}@._\s-]/gu, "").split(/\s+/).filter(Boolean).map((word) => `(from:${word.replace(/^-+/, "")} OR subject:${word.replace(/^-+/, "")})`).join(" ")}`, since);
    // The capitals' twin keeps the groups whole, so only its own control fails.
    everyWordInItsGroup(capitals);
    failsWith(() => noOperatorCapitals(capitals), "no capital of a word reaches Gmail");
  });

  it("searches the words a person writes as one group, so none of them reaches past the inbox", () => {
    expect(wordsSearch("approved")).toBe("(approved)");
    expect(wordsSearch('"quarterly report" draft')).toBe('("quarterly report" draft)');
    // What would close the group or open another is read as a space.
    expect(wordsSearch("approved) OR {in:anywhere")).toBe("(approved OR in:anywhere)");
    expect(wordsSearch('"quote left open')).toBe("(quote left open)");
    expect(wordsSearch("( ) {}")).toBe("");
    // An empty phrase and a minus sign with no word after it are no search of their own; a phrase keeps its sign.
    expect(wordsSearch('"" -')).toBe("");
    expect(wordsSearch('invoice "" - march')).toBe("(invoice march)");
    expect(wordsSearch('-"draft copy" report')).toBe('(-"draft copy" report)');
    // A phrase keeps its words as they came, and one with no letter or figure is no search either.
    expect(wordsSearch('"a - b"')).toBe('("a - b")');
    expect(wordsSearch('"-" ". ."')).toBe("");
    // The words' own groups stay when they pair and nest, so an exclusion stays one; an empty group goes.
    expect(wordsSearch("report -(draft)")).toBe("(report -(draft))");
    expect(wordsSearch("{invoice receipt} -(draft copy)")).toBe("({invoice receipt} -(draft copy))");
    expect(wordsSearch("report -() {}")).toBe("(report)");
    expect(wordsSearch("({a)}")).toBe("(a)");
  });

  it("turns Gmail's labels and date into the product's message", () => {
    const message: GmailMessage = {
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
      snippet: "Your app review was approved",
      internalDate: String(Date.parse("2026-10-29T14:58:00Z")),
      payload: { headers: [{ name: "From", value: "Developer Platform <noreply@developers.example>" }, { name: "To", value: "me@example.com" }, { name: "Subject", value: "" }] },
    };
    expect(toMailMessage(message, { id: "acc", email: "me@example.com" })).toEqual({
      id: "m1",
      threadId: "t1",
      accountId: "acc",
      accountEmail: "me@example.com",
      from: { name: "Developer Platform", email: "noreply@developers.example" },
      to: ["me@example.com"],
      // As it came: the screens name a message without a subject.
      subject: "",
      snippet: "Your app review was approved",
      receivedAt: "2026-10-29T14:58:00.000Z",
      unread: true,
      important: true,
    });
  });

  it("searches from a moment in Gmail's seconds", () => {
    expect(searchFrom("in:inbox", "2026-10-29T00:00:00Z")).toBe(`in:inbox after:${Date.parse("2026-10-29T00:00:00Z") / 1000}`);
    expect(searchFrom("in:inbox")).toBe("in:inbox");
  });

  it("pairs each answer of a batch with the read it answers, whatever their order", () => {
    const body = [
      "--batch_x",
      "Content-Type: application/http",
      "Content-ID: <response-item1>",
      "",
      "HTTP/1.1 404 Not Found",
      "Content-Type: application/json; charset=UTF-8",
      "",
      '{"error":{"code":404,"status":"NOT_FOUND"}}',
      "--batch_x",
      "Content-Type: application/http",
      "Content-ID: <response-item0>",
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json; charset=UTF-8",
      "",
      '{"id":"m1","threadId":"t1"}',
      "--batch_x--",
      "",
    ].join("\r\n");
    const answers = splitBatch(body, "multipart/mixed; boundary=batch_x");
    expect(answers.get("item0")).toEqual({ status: 200, body: '{"id":"m1","threadId":"t1"}' });
    expect(answers.get("item1")?.status).toBe(404);
    expect(splitBatch(body, "application/json").size).toBe(0);
  });
});
