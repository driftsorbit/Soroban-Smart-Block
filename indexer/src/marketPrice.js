/**
 * Market-data observation state (#1068).
 *
 * A missing, incomplete, or stale price is reported as such. It is never
 * replaced with 0, because a zero would look like a real quote.
 */

export const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * @param {{ price: string|number|null, observed_at: string|Date|null, source?: string } | null | undefined} observation
 * @param {{ now?: number, maxAgeMs?: number }} [opts]
 * @returns {{ status: "missing"|"incomplete"|"stale"|"fresh", price: number|null, observed_at: string|null, age_ms: number|null }}
 */
export function classifyPriceObservation(observation, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!observation) {
    return { status: "missing", price: null, observed_at: null, age_ms: null };
  }

  const observedMs = observation.observed_at == null ? NaN : new Date(observation.observed_at).getTime();
  const observed_at = Number.isNaN(observedMs) ? null : new Date(observedMs).toISOString();
  const price = typeof observation.price === "number" ? observation.price : Number(observation.price);
  const priceValid = observation.price !== null && observation.price !== "" && Number.isFinite(price) && price > 0;

  if (!priceValid || observed_at === null) {
    return { status: "incomplete", price: null, observed_at, age_ms: null };
  }

  const age_ms = Math.max(0, now - observedMs);
  if (age_ms > maxAgeMs) {
    return { status: "stale", price, observed_at, age_ms };
  }
  return { status: "fresh", price, observed_at, age_ms };
}
