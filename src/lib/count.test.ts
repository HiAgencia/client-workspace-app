import { describe, expect, it } from "vitest";
import { count, plural } from "./count";

// A count says its number with the word the locale's plural rules pick, on a screen and in what the server says alike.
describe("a count", () => {
  it("says one in the singular, and none and several in the plural", () => {
    expect(count(1, "message", "messages")).toBe("1 message");
    expect(count(0, "message", "messages")).toBe("0 messages");
    expect(count(2, "message", "messages")).toBe("2 messages");
  });

  it("gives the word alone for a number shown apart", () => {
    expect(plural(1, "item", "items")).toBe("item");
    expect(plural(5, "item", "items")).toBe("items");
  });
});
