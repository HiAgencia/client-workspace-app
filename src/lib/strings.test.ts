import { describe, expect, it } from "vitest";
import { countedNow, translate, translateNow } from "./strings";

describe("the typed source of phrases", () => {
  it("reads English with no choice, whole messages with their variables", () => {
    expect(translateNow("nav.overview")).toBe("Overview");
    expect(translate("en", "workspace.deletedItem", { title: "Call the printer" })).toBe("Deleted “Call the printer”");
    expect(translate("en", "palette.nothingMatches", { query: "print" })).toBe("Nothing matches “print”. Try fewer letters or another word.");
  });

  it("reads Spanish as written for its reader, with no home region's address", () => {
    expect(translate("es", "nav.overview")).toBe("Resumen");
    expect(translate("es", "settings.languageLine")).toBe("Inglés hasta que haya una elección.");
    expect(translate("es", "offer.switchEs")).toBe("Ver en español");
    expect(translate("es", "chat.askHere", { assistant: "Muse" })).not.toMatch(/\b(tú|vos|vosotros|tu)\b/i);
  });

  it("counts with the language's own plural rules", () => {
    expect(countedNow(1, "counted.task", "counted.tasks")).toBe("1 task");
    expect(countedNow(3, "counted.task", "counted.tasks")).toBe("3 tasks");
  });

  it("keeps a variable it was not given, so a missing one reads as a defect and not as silence", () => {
    expect(translate("en", "group.movedTo", { what: "2 tasks" })).toBe("Moved 2 tasks to {day}");
  });
});
