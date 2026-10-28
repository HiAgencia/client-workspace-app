import { describe, expect, it } from "vitest";
import { firstLine, richTextToPlain, sanitizeRichText } from "./rich-text";

describe("the rich text sanitizer", () => {
  it("keeps bold, a palette color, lists, and a link, and nothing else", () => {
    const html =
      '<p>Call <strong>Ana</strong> about the <span class="tc-red">deadline</span> <a href="https://example.com/brief">brief</a></p><ul><li>one</li><li><em>two</em></li></ul>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("refuses a javascript: link, keeping its words", () => {
    const out = sanitizeRichText('<p><a href="javascript:alert(1)">click</a> and <a href=" JaVaScRiPt:alert(1)">this</a></p>');
    expect(out).toBe("<p>click and this</p>");
    expect(out).not.toMatch(/javascript/i);
  });

  it("drops scripts, styles, event handlers, unknown colors, and inline style", () => {
    const out = sanitizeRichText(
      '<p onclick="x()" style="color:red">Hi<script>alert(1)</script><style>p{}</style> <span class="tc-pink" style="x">there</span> <img src=x onerror=alert(1)></p>',
    );
    expect(out).toBe("<p>Hi there </p>");
  });

  it("turns plain text into paragraphs, and an empty body into none", () => {
    expect(sanitizeRichText("Draft due Friday.")).toBe("<p>Draft due Friday.</p>");
    expect(sanitizeRichText("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
    expect(sanitizeRichText("   ")).toBeNull();
    expect(sanitizeRichText("<p></p><p><br></p>")).toBeNull();
  });

  it("closes what the input left open and maps b, i, and div to the closed list", () => {
    expect(sanitizeRichText("<div><b>bold<i>both</div>")).toBe("<p><strong>bold<em>both</em></strong></p>");
  });

  it("reads back the same HTML it wrote (round trip)", () => {
    const once = sanitizeRichText('<p>A <span class="tc-blue"><strong>b</strong></span> <a href="mailto:a@example.com">mail</a></p>');
    expect(sanitizeRichText(once)).toBe(once);
  });

  it("gives the plain text and a note's first line", () => {
    const html = "<p>Kickoff with <strong>Acme</strong></p><ul><li>budget</li><li>dates</li></ul>";
    expect(richTextToPlain(html)).toBe("Kickoff with Acme\nbudget\ndates");
    expect(firstLine(html)).toBe("Kickoff with Acme");
  });
});
