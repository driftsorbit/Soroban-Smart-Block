import { describe, it, expect } from "vitest";
import {
  MAX_BINS,
  binEventsByLedger,
  clampLedger,
  eventsInWindow,
  intervalOf,
  stepLedger,
} from "./ledgerScrubber";

const events = [{ ledger: 10 }, { ledger: 10 }, { ledger: 14 }, { ledger: 19 }, { ledger: 20 }];

describe("intervalOf", () => {
  it("returns the smallest and largest ledger", () => {
    expect(intervalOf(events)).toEqual({ start: 10, end: 20 });
  });

  it("returns null when there are no events", () => {
    expect(intervalOf([])).toBeNull();
  });
});

describe("clampLedger and stepLedger", () => {
  const interval = { start: 10, end: 20 };

  it("keeps a ledger inside the interval", () => {
    expect(clampLedger(5, interval)).toBe(10);
    expect(clampLedger(25, interval)).toBe(20);
    expect(clampLedger(15, interval)).toBe(15);
  });

  it("steps forward and backward without leaving the interval", () => {
    expect(stepLedger(15, 3, interval)).toBe(18);
    expect(stepLedger(18, 5, interval)).toBe(20);
    expect(stepLedger(11, -5, interval)).toBe(10);
  });
});

describe("binEventsByLedger", () => {
  it("counts events per equal-width bucket across the interval", () => {
    // span 11 ledgers (10..20) across 2 buckets: 10..15 and 16..20
    expect(binEventsByLedger(events, { start: 10, end: 20 }, 2)).toEqual([3, 2]);
  });

  it("ignores events outside the interval", () => {
    expect(binEventsByLedger(events, { start: 12, end: 15 }, 1)).toEqual([1]);
  });

  it("returns zeros for an empty event list", () => {
    expect(binEventsByLedger([], { start: 1, end: 100 }, 4)).toEqual([0, 0, 0, 0]);
  });

  it("clamps the bucket count to at least one and at most MAX_BINS", () => {
    expect(binEventsByLedger(events, { start: 10, end: 20 }, 0)).toHaveLength(1);
    expect(binEventsByLedger(events, { start: 10, end: 20 }, 10_000)).toHaveLength(MAX_BINS);
  });

  it("places the final ledger in the last bucket rather than past it", () => {
    const counts = binEventsByLedger([{ ledger: 20 }], { start: 10, end: 20 }, 3);
    expect(counts).toEqual([0, 0, 1]);
  });
});

describe("eventsInWindow", () => {
  it("returns events whose ledger falls inside the window", () => {
    expect(eventsInWindow(events, 10, 5)).toEqual([{ ledger: 10 }, { ledger: 10 }, { ledger: 14 }]);
  });

  it("treats a window size below one as one ledger", () => {
    expect(eventsInWindow(events, 19, 0)).toEqual([{ ledger: 19 }]);
  });

  it("keeps the event fields it was given", () => {
    const tagged = [{ ledger: 12, fn: "mint" }];
    expect(eventsInWindow(tagged, 12, 1)).toEqual(tagged);
  });
});
