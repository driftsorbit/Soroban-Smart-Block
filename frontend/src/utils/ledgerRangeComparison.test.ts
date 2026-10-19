import { describe, it, expect } from "vitest";
import {
  MAX_RANGE_SPAN,
  compareLedgerRanges,
  summarizeRange,
  validateLedgerRange,
  type ComparableEvent,
} from "./ledgerRangeComparison";

const events: ComparableEvent[] = [
  { ledger: 100, contract_id: "C1", function: "transfer" },
  { ledger: 101, contract_id: "C1", function: "mint" },
  { ledger: 105, contract_id: "C2", function: "transfer" },
  { ledger: 200, contract_id: "C3", function: "burn" },
  { ledger: 201, contract_id: "C3", function: "burn" },
];

describe("validateLedgerRange", () => {
  it("accepts a well-formed range", () => {
    expect(validateLedgerRange({ start: 100, end: 110 })).toEqual({ ok: true });
  });

  it("accepts a single-ledger range", () => {
    expect(validateLedgerRange({ start: 7, end: 7 }).ok).toBe(true);
  });

  it("rejects non-integer bounds", () => {
    expect(validateLedgerRange({ start: 1.5, end: 3 }).ok).toBe(false);
    expect(validateLedgerRange({ start: 1, end: Number.NaN }).ok).toBe(false);
  });

  it("rejects negative bounds", () => {
    expect(validateLedgerRange({ start: -1, end: 3 }).ok).toBe(false);
  });

  it("rejects an end before the start", () => {
    const res = validateLedgerRange({ start: 10, end: 9 });
    expect(res).toEqual({ ok: false, error: "End ledger must be greater than or equal to start ledger" });
  });

  it("rejects spans longer than MAX_RANGE_SPAN", () => {
    expect(validateLedgerRange({ start: 0, end: MAX_RANGE_SPAN - 1 }).ok).toBe(true);
    expect(validateLedgerRange({ start: 0, end: MAX_RANGE_SPAN }).ok).toBe(false);
  });
});

describe("summarizeRange", () => {
  it("counts events, distinct contracts and function mix inside the range", () => {
    const s = summarizeRange(events, { start: 100, end: 105 });
    expect(s.eventCount).toBe(3);
    expect(s.activeContracts).toBe(2);
    expect(s.functionMix).toEqual({ transfer: 2, mint: 1 });
  });

  it("includes both boundary ledgers", () => {
    expect(summarizeRange(events, { start: 200, end: 201 }).eventCount).toBe(2);
  });

  it("returns an empty summary when no events fall in the range", () => {
    const s = summarizeRange(events, { start: 300, end: 400 });
    expect(s).toMatchObject({ eventCount: 0, activeContracts: 0, functionMix: {} });
  });
});

describe("compareLedgerRanges", () => {
  it("reports deltas from range A to range B", () => {
    const cmp = compareLedgerRanges(events, { start: 100, end: 105 }, { start: 200, end: 201 });
    expect(cmp.a.eventCount).toBe(3);
    expect(cmp.b.eventCount).toBe(2);
    expect(cmp.eventDelta).toBe(-1);
    expect(cmp.contractDelta).toBe(-1);
  });

  it("builds a sorted function mix covering functions from either range", () => {
    const cmp = compareLedgerRanges(events, { start: 100, end: 105 }, { start: 200, end: 201 });
    expect(cmp.functions).toEqual([
      { fn: "burn", a: 0, b: 2 },
      { fn: "mint", a: 1, b: 0 },
      { fn: "transfer", a: 2, b: 0 },
    ]);
  });
});
