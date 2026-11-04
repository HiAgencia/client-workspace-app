import { describe, expect, it } from "vitest";
import { LOCALE } from "@/lib/dates";
import { documentFor } from "./mail-document";
import type { MailContent } from "./mail-viewer";

const message = (language: string | null): MailContent => ({
  id: "m1",
  threadId: "t1",
  accountId: "a1",
  accountEmail: "ops@example.com",
  from: { name: "Ana", email: "ana@example.com" },
  to: ["ops@example.com"],
  subject: "Hola",
  snippet: "Hola",
  receivedAt: "2026-10-27T12:00:00Z",
  unread: true,
  opened: false,
  important: false,
  place: null,
  tasks: [],
  nodes: [],
  html: "<p>Hola, ¿cómo va?</p>",
  text: null,
  remoteImages: 0,
  language,
});

const langOf = (doc: string) => /<html lang="([^"]*)">/.exec(doc)?.[1];

describe("the document a message is painted in", () => {
  it("declares the language the message declares", () => {
    expect(langOf(documentFor(message("es-AR"), "light", false).doc)).toBe("es-AR");
  });

  it("declares the product's language when the message declares none", () => {
    expect(langOf(documentFor(message(null), "light", false).doc)).toBe(LOCALE.split("-")[0]);
  });

  it("never writes a declared value outside its attribute", () => {
    expect(documentFor(message('en"><script>'), "light", false).doc).not.toContain("<script>");
  });
});

describe("the air around a message", () => {
  it("lets a design with its own background reach the sheet's edge", () => {
    const own = { ...message(null), html: '<table width="100%" style="font-family:Arial;background:#eef1f6"><tr><td>Hola</td></tr></table>' };
    expect(documentFor(own, "light", false).doc).toContain("body{padding:0px;");
    const attribute = { ...message(null), html: '<!-- head --><table bgcolor="#eef1f6"><tr><td>Hola</td></tr></table>' };
    expect(documentFor(attribute, "light", false).doc).toContain("body{padding:0px;");
  });

  it("gives air to a message without a background, and to plain text", () => {
    const loose = { ...message(null), html: '<p style="color:#222">Hola</p><table style="background:#eee"><tr><td>Tabla</td></tr></table>' };
    expect(documentFor(loose, "light", false).doc).toContain("body{padding:16px;");
    const plain = { ...message(null), html: "", text: "Hola" };
    expect(documentFor(plain, "light", false).doc).toContain("body{padding:16px;");
  });
});

describe("the colors a message is read in", () => {
  it("leaves a message designed for white as it came in the light mode", () => {
    const { doc, adapts } = documentFor(message(null), "light", false);
    expect(adapts).toBe(false);
    expect(doc).not.toContain("invert(");
  });

  it("turns a message designed for white on a dark screen, and its pictures back", () => {
    const { doc, adapts } = documentFor(message(null), "dark", false);
    expect(adapts).toBe(false);
    expect(doc).toContain("color-scheme:light");
    expect(doc).toContain("body{box-sizing:border-box;background:Canvas;min-height:100vh;filter:invert(.92) hue-rotate(180deg)}");
    expect(doc).toContain("img,video,[background],[style*=\"background-image\"]{filter:invert(1) hue-rotate(180deg)}");
  });

  it("gives a message with its own dark colors its own, not the filter", () => {
    const own = { ...message(null), html: "<style>@media (prefers-color-scheme: dark){body{color:white}}</style><p>Hola</p>" };
    const { doc, adapts } = documentFor(own, "dark", false);
    expect(adapts).toBe(true);
    expect(doc).toContain("color-scheme:dark");
    expect(doc).not.toContain("invert(");
    expect(doc).toContain("@media (min-width: 0px)");
  });

  it("reads plain text in the product's colors", () => {
    const plain = { ...message(null), html: "", text: "Hola" };
    const { doc, adapts } = documentFor(plain, "dark", false);
    expect(adapts).toBe(true);
    expect(doc).toContain("color-scheme:dark");
    expect(doc).not.toContain("invert(");
  });
});
