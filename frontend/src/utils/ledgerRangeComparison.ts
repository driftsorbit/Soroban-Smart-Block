/**
 * Ledger-range comparison (#1030)
 * Summarises contract activity inside two ledger ranges so they can be
 * compared side by side: event volume, distinct active contracts and the
 * function mix. Pure functions only; the component does the fetching.
 */

export const MAX_RANGE_SPAN = 10_000;

export interface LedgerRange {
  start: number;
  end: number;
}

export interface ComparableEvent {
  ledger: number;
  contract_id: string;
  function: string;
}

export interface RangeSummary {
  range: LedgerRange;
  eventCount: number;
  activeContracts: number;
  functionMix: Record<string, number>;
}

export interface FunctionMixRow {
  fn: string;
  a: number;
  b: number;
}

export interface LedgerRangeComparison {
  a: RangeSummary;
  b: RangeSummary;
  eventDelta: number;
  contractDelta: number;
  functions: FunctionMixRow[];
}

export type RangeValidation = { ok: true } | { ok: false; error: string };

export function validateLedgerRange(range: LedgerRange): RangeValidation {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    return { ok: false, error: "Ledger bounds must be whole numbers" };
  }
  if (range.start < 0) {
    return { ok: false, error: "Ledger bounds cannot be negative" };
  }
  if (range.end < range.start) {
    return { ok: false, error: "End ledger must be greater than or equal to start ledger" };
  }
  if (range.end - range.start + 1 > MAX_RANGE_SPAN) {
    return { ok: false, error: `A range may span at most ${MAX_RANGE_SPAN.toLocaleString()} ledgers` };
  }
  return { ok: true };
}

export function summarizeRange(events: ComparableEvent[], range: LedgerRange): RangeSummary {
  const inRange = events.filter((e) => e.ledger >= range.start && e.ledger <= range.end);
  const contracts = new Set<string>();
  const functionMix: Record<string, number> = {};
  for (const e of inRange) {
    contracts.add(e.contract_id);
    functionMix[e.function] = (functionMix[e.function] ?? 0) + 1;
  }
  return {
    range,
    eventCount: inRange.length,
    activeContracts: contracts.size,
    functionMix,
  };
}

export function compareLedgerRanges(
  events: ComparableEvent[],
  rangeA: LedgerRange,
  rangeB: LedgerRange,
): LedgerRangeComparison {
  const a = summarizeRange(events, rangeA);
  const b = summarizeRange(events, rangeB);
  const fns = Array.from(new Set([...Object.keys(a.functionMix), ...Object.keys(b.functionMix)])).sort();
  return {
    a,
    b,
    eventDelta: b.eventCount - a.eventCount,
    contractDelta: b.activeContracts - a.activeContracts,
    functions: fns.map((fn) => ({ fn, a: a.functionMix[fn] ?? 0, b: b.functionMix[fn] ?? 0 })),
  };
}
