import { describe, expect, it } from "vitest";
import { splitBatch, type GmailMessage } from "./api";
import { addressList, bodiesOf, decodeWords, parseAddress, searchFrom, senderSearch, snippetText, toMailMessage, wordsSearch } from "./gmail";

const encode = (text: string, charset: BufferEncoding = "utf8") => Buffer.from(text, charset).toString("base64url");

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

  it("searches for some senders with the words each one is named by", () => {
    expect(senderSearch(["Bayside Bank"])).toBe("from:(Bayside Bank)");
    expect(senderSearch(["Bayside Bank", "noreply@developers.example"])).toBe("{from:(Bayside Bank) from:(noreply@developers.example)}");
    // What would change the search's own grouping is left out.
    expect(senderSearch(['"Ana" (Studio)', "-x", "()"])).toBe("{from:(Ana Studio) from:(x)}");
    expect(senderSearch(["()"])).toBe("");
  });

  it("searches the words a person writes as one group, so none of them reaches past the inbox", () => {
    expect(wordsSearch("approved")).toBe("(approved)");
    expect(wordsSearch('"quarterly report" draft')).toBe('("quarterly report" draft)');
    // What would close the group or open another is read as a space.
    expect(wordsSearch("approved) OR {in:anywhere")).toBe("(approved OR in:anywhere)");
    expect(wordsSearch('"quote left open')).toBe("(quote left open)");
    expect(wordsSearch("( ) {}")).toBe("");
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
