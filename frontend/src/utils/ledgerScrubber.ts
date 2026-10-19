/**
 * Ledger-time scrubber (#1033)
 * Pure helpers for moving a window through a bounded ledger interval and
 * showing event density across it. The caller passes already-filtered events,
 * so the scrubber never changes the active filters.
 */

export interface LedgerInterval {
  start: number;
  end: number;
}

export const MIN_WINDOW = 1;
export const MAX_BINS = 200;

/** Smallest and largest ledger across the events, or null when there are none. */
export function intervalOf(events: { ledger: number }[]): LedgerInterval | null {
  if (events.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const e of events) {
    if (e.ledger < start) start = e.ledger;
    if (e.ledger > end) end = e.ledger;
  }
  return { start, end };
}

export function clampLedger(ledger: number, interval: LedgerInterval): number {
  return Math.min(interval.end, Math.max(interval.start, ledger));
}

/** Moves the window start by `delta` ledgers, keeping it inside the interval. */
export function stepLedger(current: number, delta: number, interval: LedgerInterval): number {
  return clampLedger(current + delta, interval);
}

/** Counts events per equal-width bucket across the interval. */
export function binEventsByLedger(
  events: { ledger: number }[],
  interval: LedgerInterval,
  bins: number,
): number[] {
  const count = Math.min(Math.max(1, Math.floor(bins)), MAX_BINS);
  const span = interval.end - interval.start + 1;
  const counts = new Array<number>(count).fill(0);
  for (const e of events) {
    if (e.ledger < interval.start || e.ledger > interval.end) continue;
    const bucket = Math.min(count - 1, Math.floor(((e.ledger - interval.start) * count) / span));
    counts[bucket] += 1;
  }
  return counts;
}

/** Events whose ledger falls inside [from, from + windowSize - 1]. */
export function eventsInWindow<T extends { ledger: number }>(events: T[], from: number, windowSize: number): T[] {
  const to = from + Math.max(MIN_WINDOW, windowSize) - 1;
  return events.filter((e) => e.ledger >= from && e.ledger <= to);
}
