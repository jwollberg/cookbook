import { describe, it, expect } from "vitest";
import { addDays, formatRange, fromIso, isoDate, startOfWeek, weekDates } from "./dates";

describe("local date handling", () => {
  it("formats a date without shifting it into UTC", () => {
    // 23:30 local. toISOString() would report the NEXT day for anyone east of
    // Greenwich and is the classic way a plan slips by one.
    expect(isoDate(new Date(2026, 7, 12, 23, 30))).toBe("2026-08-12");
    // 00:30 local — the same trap in the other direction.
    expect(isoDate(new Date(2026, 7, 12, 0, 30))).toBe("2026-08-12");
  });

  it("round-trips through fromIso", () => {
    expect(isoDate(fromIso("2026-08-12"))).toBe("2026-08-12");
    expect(fromIso("2026-01-01").getMonth()).toBe(0);
  });

  it("pads single-digit months and days", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of the containing week", () => {
    // 2026-08-12 is a Wednesday.
    expect(isoDate(startOfWeek(fromIso("2026-08-12")))).toBe("2026-08-10");
  });

  it("treats Sunday as the END of a week, not the start", () => {
    // Sunday 2026-08-16 belongs to the week beginning Monday the 10th.
    expect(isoDate(startOfWeek(fromIso("2026-08-16")))).toBe("2026-08-10");
  });

  it("is a no-op on a Monday", () => {
    expect(isoDate(startOfWeek(fromIso("2026-08-10")))).toBe("2026-08-10");
  });
});

describe("weekDates", () => {
  it("gives seven consecutive days", () => {
    const days = weekDates(fromIso("2026-08-10"));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-10");
    expect(days[6]).toBe("2026-08-16");
  });

  it("crosses a month boundary correctly", () => {
    const days = weekDates(fromIso("2026-08-31"));
    expect(days[0]).toBe("2026-08-31");
    expect(days[1]).toBe("2026-09-01");
  });

  it("crosses a leap day", () => {
    const days = weekDates(fromIso("2028-02-28"), 3);
    expect(days).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
});

describe("addDays", () => {
  it("does not mutate its input", () => {
    const start = fromIso("2026-08-12");
    addDays(start, 5);
    expect(isoDate(start)).toBe("2026-08-12");
  });
});

describe("formatRange", () => {
  it("collapses the month when both ends share it", () => {
    expect(formatRange("2026-08-10", "2026-08-16")).toBe("10–16 Aug");
  });

  it("shows both months when the week straddles one", () => {
    expect(formatRange("2026-08-31", "2026-09-06")).toMatch(/Aug.*Sep/);
  });
});
