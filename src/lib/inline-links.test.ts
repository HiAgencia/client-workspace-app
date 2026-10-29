import { describe, expect, it } from "vitest";
import { inlineLink, inlinePieces, inlinePlain, writtenBody } from "./inline-links";
import { firstLine, noteTitle } from "./rich-text";

describe("links over words", () => {
  it("writes the words and the address so neither ends the link early", () => {
    expect(inlineLink("Project brief", "https://docs.example/brief")).toBe("[Project brief](https://docs.example/brief)");
    expect(inlineLink(" [Draft] v2 ", "https://site.example/a_(b)")).toBe("[(Draft) v2](https://site.example/a_%28b%29)");
  });

  it("reads plain runs and links, and leaves an address outside http, https, or mailto as text", () => {
    expect(inlinePieces("Read [the brief](https://docs.example/brief) first")).toEqual([
      { text: "Read ", href: null },
      { text: "the brief", href: "https://docs.example/brief" },
      { text: " first", href: null },
    ]);
    expect(inlinePieces("[run](javascript:alert(1))")).toEqual([{ text: "[run](javascript:alert(1))", href: null }]);
    expect(inlinePieces("Plain text, Vec<String> and [brackets] stay whole")).toEqual([{ text: "Plain text, Vec<String> and [brackets] stay whole", href: null }]);
    // What inlineLink writes reads back as the same words and address.
    const written = inlineLink("Draft (v2)", "https://site.example/a_(b)");
    expect(inlinePieces(written)).toEqual([{ text: "Draft (v2)", href: "https://site.example/a_%28b%29" }]);
  });

  it("a written note keeps its link as a real link in its body and over its words in its title", () => {
    const body = writtenBody("Compare [the new prices](https://ads.example/prices) first\nThen decide");
    expect(body).toBe('<p>Compare <a href="https://ads.example/prices">the new prices</a> first</p><p>Then decide</p>');
    expect(noteTitle(body)).toBe("Compare [the new prices](https://ads.example/prices) first");
    expect(firstLine(body)).toBe("Compare the new prices first");
    // Text without a link, and the closed list's HTML, pass as they always did.
    expect(writtenBody("Vec<String> stays whole")).toBe("<p>Vec&lt;String&gt; stays whole</p>");
    expect(writtenBody('<p><a href="https://a.example/x">A</a></p>')).toBe('<p><a href="https://a.example/x">A</a></p>');
    // An address that is not http, https, or mailto stays as the text it was.
    expect(writtenBody("[run](javascript:alert)")).toBe("<p>[run](javascript:alert)</p>");
    expect(noteTitle('<p><a href="https://a.example/x">A [draft]</a> and more</p>')).toBe("[A (draft)](https://a.example/x) and more");
  });

  it("reads as its words without the addresses", () => {
    expect(inlinePlain("Ask [Maya](mailto:maya@studio.example) and [the team](https://team.example)")).toBe("Ask Maya and the team");
  });
});
