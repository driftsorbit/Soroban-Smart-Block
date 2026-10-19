/**
 * valueSnapshots.ts — optional, browser-only portfolio value history (#1044).
 *
 * A snapshot is recorded only when the user asks for one. It captures the XLM
 * balance from Horizon plus an XLM/USD rate when one is available. Other assets
 * have no price source here, so they are counted but never valued, and a
 * missing rate is stored as an explicit "unavailable" state rather than zero.
 */
import type { HorizonBalance } from "../api";

export const SNAPSHOT_HISTORY_LIMIT = 50;
export const SNAPSHOT_SOURCE = "horizon+coingecko";

export type PriceState =
  | { status: "available"; usd_per_xlm: number; source: "coingecko"; fetched_at: string }
  | { status: "unavailable"; reason: string };

export interface ValueSnapshot {
  /** When the balances were read. ISO-8601. */
  observed_at: string;
  /** Where the balances came from. */
  source: typeof SNAPSHOT_SOURCE;
  xlm_balance: string;
  /** Non-XLM asset rows present at observation time; these are not valued. */
  unpriced_asset_count: number;
  price: PriceState;
  /** XLM value in USD, or null when no rate was available. */
  usd_value: number | null;
}

export function buildSnapshot(input: {
  balances: HorizonBalance[];
  usdPerXlm: number | null;
  observedAt: Date;
  fetchedAt: Date;
}): ValueSnapshot {
  const xlm = input.balances.find((b) => b.asset_type === "native");
  const xlmBalance = xlm?.balance ?? "0";
  const unpriced = input.balances.filter((b) => b.asset_type !== "native").length;
  const amount = Number(xlmBalance);

  const hasRate = input.usdPerXlm !== null && Number.isFinite(input.usdPerXlm) && input.usdPerXlm >= 0;
  const price: PriceState = hasRate
    ? { status: "available", usd_per_xlm: input.usdPerXlm as number, source: "coingecko", fetched_at: input.fetchedAt.toISOString() }
    : { status: "unavailable", reason: "No XLM/USD rate was returned by the price source." };

  return {
    observed_at: input.observedAt.toISOString(),
    source: SNAPSHOT_SOURCE,
    xlm_balance: xlmBalance,
    unpriced_asset_count: unpriced,
    price,
    usd_value: hasRate && Number.isFinite(amount) ? amount * (input.usdPerXlm as number) : null,
  };
}

/** Appends a snapshot, keeping only the most recent `limit` entries. */
export function appendSnapshot(history: ValueSnapshot[], snapshot: ValueSnapshot, limit = SNAPSHOT_HISTORY_LIMIT): ValueSnapshot[] {
  return [...history, snapshot].slice(-limit);
}

export function snapshotStorageKey(address: string): string {
  return `soroban-explorer:value-snapshots:v1:${address}`;
}

type SnapshotStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isSnapshot(value: unknown): value is ValueSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ValueSnapshot>;
  return typeof v.observed_at === "string" && typeof v.xlm_balance === "string" && typeof v.price === "object" && v.price !== null;
}

/** Reads stored history for an address. Corrupt entries are dropped, never thrown. */
export function readSnapshots(address: string, storage: SnapshotStorage | null): ValueSnapshot[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(snapshotStorageKey(address));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSnapshot).slice(-SNAPSHOT_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Writes history for an address. Returns false if storage is unavailable or full. */
export function writeSnapshots(address: string, history: ValueSnapshot[], storage: SnapshotStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(snapshotStorageKey(address), JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}
