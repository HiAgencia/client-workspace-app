import { describe, expect, it } from "vitest";
import { readQuickAdd, type QuickAddPlace } from "./quick-add";

// A Wednesday.
const today = "2026-10-28";

const website: QuickAddPlace = { id: "larkspur-website", name: "Website", path: "Larkspur Bakery / Website" };
const atlasWebsite: QuickAddPlace = { id: "atlas-website", name: "Website", path: "Studio Atlas / Website" };
const larkspur: QuickAddPlace = { id: "larkspur", name: "Larkspur Bakery", path: "Larkspur Bakery" };
const operations: QuickAddPlace = { id: "operations", name: "Operations", path: "Operations" };

const read = (text: string, places: QuickAddPlace[] = [website, larkspur, operations], dismissed = []) =>
  readQuickAdd(text, { today, places, dismissed });

describe("quick add reads what is typed", () => {
  it("reads a day with its hour, a place, and a priority, and leaves the rest as the title", () => {
    const text = "Call the printer about the menu cards tomorrow 4pm #Website p2";
    const reading = read(text);
    expect(reading.title).toBe("Call the printer about the menu cards");
    expect(reading.day).toBe("2026-10-29");
    expect(reading.time).toBe("16:00");
    expect(reading.place).toEqual(website);
    expect(reading.priority).toBe(2);
    expect(reading.pieces.map((piece) => [piece.kind, piece.text])).toEqual([
      ["date", "tomorrow 4pm"],
      ["place", "#Website"],
      ["priority", "p2"],
    ]);
    for (const piece of reading.pieces) expect(text.slice(piece.start, piece.end)).toBe(piece.text);
  });

  it("reads a weekday as its next one, and «next» as the one of the following week", () => {
    expect(read("Send the invoices friday").day).toBe("2026-10-30");
    expect(read("Send the invoices next friday").day).toBe("2026-11-06");
    expect(read("Send the invoices wednesday").day).toBe("2026-11-04");
    expect(read("Review the draft on monday")).toMatchObject({ day: "2026-11-02", title: "Review the draft" });
    expect(read("Plan the quarter next week").day).toBe("2026-11-02");
  });

  it("reads a count of days, weeks, or months", () => {
    expect(read("Follow up in 3 days").day).toBe("2026-10-31");
    expect(read("Follow up in a week").day).toBe("2026-11-04");
    expect(read("Renew the domain in 2 months").day).toBe("2026-12-28");
  });

  it("reads a month and a day, taking one already past into next year", () => {
    expect(read("Pay the rent oct 30").day).toBe("2026-10-30");
    expect(read("Pay the rent 30 October").day).toBe("2026-10-30");
    expect(read("File the taxes jan 5th").day).toBe("2027-01-05");
    expect(read("Book the venue feb 30")).toMatchObject({ day: null, title: "Book the venue feb 30" });
  });

  it("reads a short weekday that is also a word only after «on», «by», or «next», or beside an hour", () => {
    expect(read("Fix the sun banner")).toMatchObject({ day: null, title: "Fix the sun banner" });
    expect(read("Sat on the report")).toMatchObject({ day: null, title: "Sat on the report" });
    expect(read("Look at sun spots")).toMatchObject({ day: null, title: "Look at sun spots" });
    expect(read("Pay the rent on sat")).toMatchObject({ day: "2026-10-31", title: "Pay the rent" });
    expect(read("Send the deck by mon")).toMatchObject({ day: "2026-11-02", title: "Send the deck" });
    expect(read("Book the room next wed")).toMatchObject({ day: "2026-11-04", title: "Book the room" });
    expect(read("Brunch sun 11am")).toMatchObject({ day: "2026-11-01", time: "11:00", title: "Brunch" });
    expect(read("Ship it fri")).toMatchObject({ day: "2026-10-30", title: "Ship it" });
    expect(read("Plan the sun deck tomorrow")).toMatchObject({ day: "2026-10-29", title: "Plan the sun deck" });
  });

  it("reads an hour alone that already passed as tomorrow's", () => {
    const at = (text: string, clock: string) => readQuickAdd(text, { today, clock, places: [] });
    expect(at("Call Ana 9am", "10:15")).toMatchObject({ day: "2026-10-29", time: "09:00", title: "Call Ana" });
    expect(at("Call Ana 9am", "08:59")).toMatchObject({ day: today, time: "09:00" });
    expect(at("Call Ana 9am", "09:00")).toMatchObject({ day: today, time: "09:00" });
    expect(at("Call Ana friday 9am", "10:15")).toMatchObject({ day: "2026-10-30", time: "09:00" });
  });

  it("reads an hour alone as today's, on either clock", () => {
    expect(read("Call Ana 4pm")).toMatchObject({ day: today, time: "16:00", title: "Call Ana" });
    expect(read("Call Ana at 16:30")).toMatchObject({ day: today, time: "16:30", title: "Call Ana" });
    expect(read("Lunch with Ana at noon")).toMatchObject({ time: "12:00", title: "Lunch with Ana" });
    expect(read("Close the day 12am").time).toBe("00:00");
    expect(read("Stand-up 12pm").time).toBe("12:00");
    expect(read("Call Ana 13pm")).toMatchObject({ day: null, time: null, title: "Call Ana 13pm" });
  });

  it("joins an hour written before its day", () => {
    expect(read("Call Ana 9:30am friday")).toMatchObject({ day: "2026-10-30", time: "09:30", title: "Call Ana" });
    expect(read("Call Ana friday at 16:00")).toMatchObject({ day: "2026-10-30", time: "16:00", title: "Call Ana" });
  });

  it("keeps a day that is part of a phrase, and the last day written is the task's", () => {
    expect(read("Plan Friday's party tomorrow")).toMatchObject({ day: "2026-10-29", title: "Plan Friday's party" });
    expect(read("Move the monday meeting thursday")).toMatchObject({ day: "2026-10-29", title: "Move the monday meeting" });
  });

  it("never reads inside a link written over words", () => {
    const reading = read("Read [the friday notes](https://example.com/friday) tomorrow");
    expect(reading.day).toBe("2026-10-29");
    expect(reading.title).toBe("Read [the friday notes](https://example.com/friday)");
  });

  it("takes a place's whole path or name, and offers the candidates when a name is shared", () => {
    const both = [website, atlasWebsite, larkspur];
    expect(read("Fix the footer #Website", both)).toMatchObject({ place: null, title: "Fix the footer" });
    expect(read("Fix the footer #Website", both).placeCandidates).toEqual([website, atlasWebsite]);
    expect(read("Fix the footer #Larkspur Bakery / Website", both).place).toEqual(website);
    expect(read("Fix the footer #larkspur bakery").place).toEqual(larkspur);
  });

  it("leaves a «#» inside a word alone, and says when no place answers", () => {
    expect(read("Port the C# helpers")).toMatchObject({ place: null, unknownPlace: null, title: "Port the C# helpers" });
    expect(read("Draft the brief #Websit")).toMatchObject({ place: null, unknownPlace: "Websit", title: "Draft the brief #Websit" });
  });

  it("reads the last priority, in any case", () => {
    expect(read("Pay the invoice P1").priority).toBe(1);
    expect(read("Pay the invoice p4")).toMatchObject({ priority: 4, title: "Pay the invoice" });
  });

  it("reads a dismissed piece as words from then on", () => {
    const whole = readQuickAdd("Call Ana tomorrow 4pm", { today, places: [], dismissed: [{ kind: "date", text: "tomorrow 4pm" }] });
    expect(whole).toMatchObject({ day: null, time: null, title: "Call Ana tomorrow 4pm" });
    const day = readQuickAdd("Call Ana friday 4pm", { today, places: [], dismissed: [{ kind: "date", text: "friday" }] });
    expect(day).toMatchObject({ day: today, time: "16:00", title: "Call Ana friday" });
    const place = readQuickAdd("Fix it #Website", { today, places: [website], dismissed: [{ kind: "place", text: "#Website" }] });
    expect(place).toMatchObject({ place: null, title: "Fix it #Website" });
  });
});
