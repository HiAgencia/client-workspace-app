import { describe, expect, it } from "vitest";
import { isWorkingTime, validZone, workingMinutesBefore, workingMinutesBetween } from "./working-time";

const NY = "America/New_York";
// 2026-10-27 is a Tuesday; New York leaves daylight time on Sunday 2026-11-01 and enters it on Sunday 2026-03-08.

describe("working time", () => {
  it("counts only weekdays: a weekend adds nothing", () => {
    // Friday 17:00 to Monday 10:00, New York daylight time (UTC-4).
    expect(workingMinutesBetween("2026-10-23T21:00:00Z", "2026-10-26T14:00:00Z", NY)).toBe(120);
    expect(workingMinutesBetween("2026-10-24T14:00:00Z", "2026-10-25T20:00:00Z", NY)).toBe(0);
    expect(isWorkingTime("2026-10-24T15:00:00Z", NY)).toBe(false);
  });

  it("counts nothing at night", () => {
    expect(workingMinutesBetween("2026-10-28T00:00:00Z", "2026-10-28T12:00:00Z", NY)).toBe(0);
    // Tuesday 17:30 to Wednesday 09:30.
    expect(workingMinutesBetween("2026-10-27T21:30:00Z", "2026-10-28T13:30:00Z", NY)).toBe(60);
    expect(isWorkingTime("2026-10-28T05:30:00Z", NY)).toBe(false);
  });

  it("follows the zone across a DST change", () => {
    // Friday 17:00 daylight to Monday 10:00 standard: two working hours, though the clock moved.
    expect(workingMinutesBetween("2026-10-30T21:00:00Z", "2026-11-02T15:00:00Z", NY)).toBe(120);
    expect(workingMinutesBetween("2026-03-06T22:00:00Z", "2026-03-09T14:00:00Z", NY)).toBe(120);
    expect(isWorkingTime("2026-11-02T14:30:00Z", NY)).toBe(true);
    expect(isWorkingTime("2026-11-02T13:30:00Z", NY)).toBe(false);
    expect(workingMinutesBefore("2026-11-02T15:00:00Z", 120, NY).toISOString()).toBe("2026-10-30T21:00:00.000Z");
    expect(workingMinutesBefore("2026-03-09T14:00:00Z", 120, NY).toISOString()).toBe("2026-03-06T22:00:00.000Z");
  });

  it("keeps both ends of the day and the boundary rule of the walk-back", () => {
    expect(isWorkingTime("2026-10-27T13:00:00Z", NY)).toBe(true);
    expect(isWorkingTime("2026-10-27T12:59:00Z", NY)).toBe(false);
    expect(isWorkingTime("2026-10-27T22:00:00Z", NY)).toBe(true);
    expect(isWorkingTime("2026-10-27T22:01:00Z", NY)).toBe(false);
    // From Tuesday 10:00, exactly what is left of the day ends on its 09:00, one more minute on Monday's 17:59.
    expect(workingMinutesBefore("2026-10-27T14:00:00Z", 60, NY).toISOString()).toBe("2026-10-27T13:00:00.000Z");
    expect(workingMinutesBefore("2026-10-27T14:00:00Z", 61, NY).toISOString()).toBe("2026-10-26T21:59:00.000Z");
    // From outside working time the walk starts at the previous working day's 18:00.
    expect(workingMinutesBefore("2026-10-24T16:00:00Z", 0, NY).toISOString()).toBe("2026-10-23T22:00:00.000Z");
    expect(workingMinutesBefore("2026-10-26T12:00:00Z", 30, NY).toISOString()).toBe("2026-10-23T21:30:00.000Z");
    expect(workingMinutesBefore("2026-10-27T23:15:00Z", 15, NY).toISOString()).toBe("2026-10-27T21:45:00.000Z");
  });

  it("walks back and counts forward the same minutes, always landing in working time", () => {
    const now = "2026-10-28T05:41:13.250Z";
    for (const zone of [NY, "America/Argentina/Buenos_Aires", "UTC", "Asia/Tokyo"]) {
      for (const minutes of [0, 1, 41, 539, 540, 541, 1534, 4574, 7942]) {
        const moment = workingMinutesBefore(now, minutes, zone);
        expect(isWorkingTime(moment, zone), `${zone} ${minutes}`).toBe(true);
        expect(workingMinutesBetween(moment, now, zone)).toBeCloseTo(minutes, 6);
      }
    }
  });

  it("an unknown zone reads as UTC", () => {
    expect(validZone("Not/AZone")).toBe("UTC");
    expect(validZone(undefined)).toBe("UTC");
    expect(workingMinutesBetween("2026-10-27T09:00:00Z", "2026-10-27T10:00:00Z", "Not/AZone")).toBe(60);
  });
});
