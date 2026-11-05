import { describe, expect, it } from "vitest";
import { shownIcon } from "./node-icons";

describe("a place's icon", () => {
  it("uses the one given, and otherwise the mark of its kind", () => {
    expect(shownIcon("client", null)).toBe("client");
    expect(shownIcon("project", null)).toBe("project");
    expect(shownIcon("subproject", undefined)).toBe("project");
    expect(shownIcon("client", "mail")).toBe("mail");
    expect(shownIcon("project", "not-an-icon")).toBe("project");
  });
});
