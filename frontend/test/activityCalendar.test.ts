/** Issue #1040 — daily account activity calendar buckets. */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CALENDAR_RANGE,
  buildActivityCalendar,
  sanitizeCalendarRange,
  utcDayKey,
} from "../src/utils/activityCalendar";

const NOW = new Date("2026-10-17T12:00:00Z");

describe("utcDayKey (#1040)", () => {
  it("returns the UTC calendar day", () => {
    expect(utcDayKey("2026-10-16T23:59:59Z")).toBe("2026-10-16");
    // Offset timestamps are normalised to UTC before taking the day.
    expect(utcDayKey("2026-10-17T01:00:00+03:00")).toBe("2026-10-16");
  });

  it("returns null for missing or unparseable timestamps", () => {
    expect(utcDayKey(undefined)).toBeNull();
    expect(utcDayKey(null)).toBeNull();
    expect(utcDayKey("")).toBeNull();
    expect(utcDayKey("not a date")).toBeNull();
  });
});

describe("sanitizeCalendarRange (#1040)", () => {
  it("accepts the supported ranges", () => {
    expect(sanitizeCalendarRange(7)).toBe(7);
    expect(sanitizeCalendarRange(90)).toBe(90);
  });

  it("falls back to the default for unsupported values", () => {
    expect(sanitizeCalendarRange(14)).toBe(DEFAULT_CALENDAR_RANGE);
    expect(sanitizeCalendarRange("7")).toBe(DEFAULT_CALENDAR_RANGE);
    expect(sanitizeCalendarRange(undefined)).toBe(DEFAULT_CALENDAR_RANGE);
  });
});

describe("buildActivityCalendar (#1040)", () => {
  it("returns one zero-filled entry per day, oldest first, ending today", () => {
    const cal = buildActivityCalendar([], 7, NOW);
    expect(cal.days).toHaveLength(7);
    expect(cal.days[0].date).toBe("2026-10-11");
    expect(cal.days[6].date).toBe("2026-10-17");
    expect(cal.total).toBe(0);
    expect(cal.undated).toBe(0);
  });

  it("counts events per day and records the first seq of each day", () => {
    const events = [
      { seq: 12, closed_at: "2026-10-17T08:00:00Z" },
      { seq: 5, closed_at: "2026-10-17T01:00:00Z" },
      { seq: 9, closed_at: "2026-10-15T10:00:00Z" },
    ];
    const cal = buildActivityCalendar(events, 7, NOW);
    const today = cal.days[6];
    expect(today).toEqual({ date: "2026-10-17", count: 2, firstSeq: 5 });
    expect(cal.days[4]).toEqual({ date: "2026-10-15", count: 1, firstSeq: 9 });
    expect(cal.total).toBe(3);
  });

  it("includes the first and last day of the range (boundary)", () => {
    const events = [
      { seq: 1, closed_at: "2026-10-11T00:00:00Z" },
      { seq: 2, closed_at: "2026-10-17T23:59:59Z" },
    ];
    const cal = buildActivityCalendar(events, 7, NOW);
    expect(cal.total).toBe(2);
  });

  it("drops dated events that fall outside the range without counting them as undated", () => {
    const events = [{ seq: 1, closed_at: "2026-09-01T00:00:00Z" }];
    const cal = buildActivityCalendar(events, 7, NOW);
    expect(cal.total).toBe(0);
    expect(cal.undated).toBe(0);
  });

  it("counts events without a usable timestamp as undated", () => {
    const events = [
      { seq: 1 },
      { seq: 2, closed_at: null },
      { seq: 3, closed_at: "garbage" },
    ];
    const cal = buildActivityCalendar(events, 30, NOW);
    expect(cal.total).toBe(0);
    expect(cal.undated).toBe(3);
  });

  it("covers a 90-day range", () => {
    const cal = buildActivityCalendar([], 90, NOW);
    expect(cal.days).toHaveLength(90);
    expect(cal.days[0].date).toBe("2026-07-20");
  });
});
