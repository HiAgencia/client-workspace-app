import { describe, expect, it } from "vitest";
import { mailWhen } from "./when";

const at = (year: number, month: number, day: number, hour = 9, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
const TODAY = "2026-11-04";

describe("when a message arrived, as every list of mail says it", () => {
  it("says the hour of today's mail", () => {
    expect(mailWhen(at(2026, 11, 4, 15, 30), TODAY)).toMatch(/^3:30\sPM$/);
  });

  it("says «Yesterday» for the day before, at any hour of it", () => {
    expect(mailWhen(at(2026, 11, 3, 0, 5), TODAY)).toBe("Yesterday");
    expect(mailWhen(at(2026, 11, 3, 23, 55), TODAY)).toBe("Yesterday");
  });

  it("says the month and day of an earlier day this year, and «Yesterday» across the first of a month", () => {
    expect(mailWhen(at(2026, 11, 2), TODAY)).toBe("Nov 2");
    expect(mailWhen(at(2026, 2, 14), TODAY)).toBe("Feb 14");
    expect(mailWhen(at(2026, 10, 31), "2026-11-01")).toBe("Yesterday");
  });

  it("adds the year for another year, also on the day before the first of January", () => {
    expect(mailWhen(at(2025, 11, 4), TODAY)).toBe("Nov 4, 2025");
    expect(mailWhen(at(2025, 12, 31), "2026-01-01")).toBe("Yesterday");
    expect(mailWhen(at(2025, 12, 30), "2026-01-01")).toBe("Dec 30, 2025");
  });
});
