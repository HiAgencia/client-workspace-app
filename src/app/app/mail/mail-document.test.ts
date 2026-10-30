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
