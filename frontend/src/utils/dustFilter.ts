/**
 * dustFilter.ts — opt-in dust detection for wallet asset balances (#1045).
 *
 * Dust is a non-XLM balance below a user-chosen threshold, in asset units.
 * Filtering only hides rows: callers keep the full list and can turn the
 * filter off. Balances that cannot be parsed are never treated as dust.
 */

export const DEFAULT_DUST_THRESHOLD = "1";
export const MAX_DUST_THRESHOLD = 1_000_000_000;

export type ThresholdResult = { ok: true; value: number } | { ok: false; error: string };

export function parseDustThreshold(input: string): ThresholdResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter a threshold to filter by." };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: "Threshold must be a number." };
  if (value < 0) return { ok: false, error: "Threshold cannot be negative." };
  if (value > MAX_DUST_THRESHOLD) return { ok: false, error: `Threshold must be ${MAX_DUST_THRESHOLD.toLocaleString("en-US")} or less.` };
  return { ok: true, value };
}

export function isDust(balance: string, threshold: number): boolean {
  const amount = Number(balance);
  return Number.isFinite(amount) && amount < threshold;
}

/** Splits balances into rows to show and rows hidden as possible dust. Order is preserved. */
export function partitionByDust<T extends { balance: string }>(balances: T[], threshold: number): { visible: T[]; dust: T[] } {
  const visible: T[] = [];
  const dust: T[] = [];
  for (const b of balances) {
    if (isDust(b.balance, threshold)) dust.push(b);
    else visible.push(b);
  }
  return { visible, dust };
}
