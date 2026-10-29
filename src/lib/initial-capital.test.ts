import { describe, expect, it } from "vitest";
import { withInitialCapital, withInitialCapitalHtml } from "./initial-capital";

describe("the initial capital", () => {
  it("changes only the first letter of a title or a name", () => {
    expect(withInitialCapital("call the printer about the menu cards")).toBe("Call the printer about the menu cards");
    expect(withInitialCapital("send the invoice to Acme")).toBe("Send the invoice to Acme");
    expect(withInitialCapital("Already Written")).toBe("Already Written");
    expect(withInitialCapital("éxito del lanzamiento")).toBe("Éxito del lanzamiento");
  });

  it("goes past the marks that open the text", () => {
    expect(withInitialCapital("[review the checkout pull request](https://code.example/pr/12)")).toBe("[Review the checkout pull request](https://code.example/pr/12)");
    expect(withInitialCapital("¿qué falta?")).toBe("¿Qué falta?");
    expect(withInitialCapital("“quote” of the client")).toBe("“Quote” of the client");
  });

  it("leaves a number, an address, and a letter whose capital is two letters as they are", () => {
    expect(withInitialCapital("3 calls to make")).toBe("3 calls to make");
    expect(withInitialCapital("https://code.example/pr/12")).toBe("https://code.example/pr/12");
    expect(withInitialCapital("ops@studio.example")).toBe("ops@studio.example");
    expect(withInitialCapital("ßtraße")).toBe("ßtraße");
    expect(withInitialCapital("")).toBe("");
  });

  it("keeps a brand that already carries a capital after its first letter as it was written", () => {
    expect(withInitialCapital("iOS release checklist")).toBe("iOS release checklist");
    expect(withInitialCapital("eBay listing for the client")).toBe("eBay listing for the client");
    expect(withInitialCapital("macOS build notes")).toBe("macOS build notes");
    expect(withInitialCapital("[iOS build](https://code.example/ios)")).toBe("[iOS build](https://code.example/ios)");
    expect(withInitialCapitalHtml("<p>iOS release notes</p>")).toBe("<p>iOS release notes</p>");
    // A word with no capital past its first letter is no brand: it takes its initial capital like any other.
    expect(withInitialCapital("npm run dev fails")).toBe("Npm run dev fails");
  });

  it("in a body, the first letter of its text, past its tags and its entities", () => {
    expect(withInitialCapitalHtml("<p>met the client today</p><p>notes</p>")).toBe("<p>Met the client today</p><p>notes</p>");
    expect(withInitialCapitalHtml('<p><a href="https://x.example">the brief</a> is in</p>')).toBe('<p><a href="https://x.example">The brief</a> is in</p>');
    expect(withInitialCapitalHtml("<p>&quot;yes&quot; they said</p>")).toBe("<p>&quot;Yes&quot; they said</p>");
    expect(withInitialCapitalHtml('<p class="tc-red">urgent</p>')).toBe('<p class="tc-red">Urgent</p>');
  });
});
