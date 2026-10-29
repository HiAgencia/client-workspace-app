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

  it("in a body, the first letter of its text, past its tags and its entities", () => {
    expect(withInitialCapitalHtml("<p>met the client today</p><p>notes</p>")).toBe("<p>Met the client today</p><p>notes</p>");
    expect(withInitialCapitalHtml('<p><a href="https://x.example">the brief</a> is in</p>')).toBe('<p><a href="https://x.example">The brief</a> is in</p>');
    expect(withInitialCapitalHtml("<p>&quot;yes&quot; they said</p>")).toBe("<p>&quot;Yes&quot; they said</p>");
    expect(withInitialCapitalHtml('<p class="tc-red">urgent</p>')).toBe('<p class="tc-red">Urgent</p>');
  });
});
