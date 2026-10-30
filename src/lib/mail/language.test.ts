import { describe, expect, it } from "vitest";
import { messageLanguage } from "./language";

describe("the language a message declares", () => {
  it("reads its Content-Language first, the first of its list", () => {
    expect(messageLanguage({ contentLanguage: "es-AR", html: '<html lang="pt"><body>Oi</body></html>' })).toBe("es-AR");
    expect(messageLanguage({ contentLanguage: "de, en", html: null })).toBe("de");
  });

  it("reads the lang of the HTML's root when the header says nothing", () => {
    expect(messageLanguage({ html: '<!doctype html><html dir="ltr" lang="fr-CA"><body><p>Bonjour</p></body></html>' })).toBe("fr-CA");
    expect(messageLanguage({ contentLanguage: "", html: "<html><body lang='pt-br'><p>Olá</p></body></html>" })).toBe("pt-BR");
    expect(messageLanguage({ html: '<html xml:lang="it"><body>Ciao</body></html>' })).toBe("it");
  });

  it("declares nothing when the message declares nothing a tag can say", () => {
    expect(messageLanguage({ html: "<p>Hello</p>" })).toBeNull();
    expect(messageLanguage({ html: null })).toBeNull();
    expect(messageLanguage({ contentLanguage: "not a language!", html: '<html lang="">x</html>' })).toBeNull();
    // A lang inside the body is a part's, not the message's.
    expect(messageLanguage({ html: '<html><body><p lang="ja">こんにちは</p></body></html>' })).toBeNull();
  });
});
