import { describe, expect, it } from "vitest";
import type { HorizonBalance } from "../api";
import {
  SNAPSHOT_HISTORY_LIMIT,
  appendSnapshot,
  buildSnapshot,
  readSnapshots,
  snapshotStorageKey,
  writeSnapshots,
  type ValueSnapshot,
} from "./valueSnapshots";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const OBSERVED = new Date("2026-10-01T12:00:00.000Z");
const FETCHED = new Date("2026-10-01T11:59:30.000Z");

const xlm: HorizonBalance = { asset_type: "native", balance: "100.0000000" };
const usdc: HorizonBalance = { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GA5Z", balance: "50.0000000" };

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(snapshotStorageKey(ADDRESS), initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("buildSnapshot", () => {
  it("values the XLM balance when a rate is available and records its fetch time", () => {
    const snap = buildSnapshot({ balances: [xlm, usdc], usdPerXlm: 0.25, observedAt: OBSERVED, fetchedAt: FETCHED });
    expect(snap.usd_value).toBe(25);
    expect(snap.price).toEqual({ status: "available", usd_per_xlm: 0.25, source: "coingecko", fetched_at: FETCHED.toISOString() });
    expect(snap.observed_at).toBe(OBSERVED.toISOString());
    expect(snap.unpriced_asset_count).toBe(1);
  });

  it("marks the price explicitly unavailable instead of reporting zero", () => {
    const snap = buildSnapshot({ balances: [xlm], usdPerXlm: null, observedAt: OBSERVED, fetchedAt: FETCHED });
    expect(snap.usd_value).toBeNull();
    expect(snap.price.status).toBe("unavailable");
  });

  it("treats a non-finite or negative rate as unavailable", () => {
    expect(buildSnapshot({ balances: [xlm], usdPerXlm: Number.NaN, observedAt: OBSERVED, fetchedAt: FETCHED }).usd_value).toBeNull();
    expect(buildSnapshot({ balances: [xlm], usdPerXlm: -1, observedAt: OBSERVED, fetchedAt: FETCHED }).usd_value).toBeNull();
  });

  it("reports a zero XLM balance when the account has no native row", () => {
    const snap = buildSnapshot({ balances: [usdc], usdPerXlm: 0.3, observedAt: OBSERVED, fetchedAt: FETCHED });
    expect(snap.xlm_balance).toBe("0");
    expect(snap.usd_value).toBe(0);
  });
});

describe("appendSnapshot", () => {
  const make = (i: number): ValueSnapshot =>
    buildSnapshot({ balances: [xlm], usdPerXlm: 1, observedAt: new Date(OBSERVED.getTime() + i), fetchedAt: FETCHED });

  it("keeps only the most recent entries up to the limit", () => {
    let history: ValueSnapshot[] = [];
    for (let i = 0; i < SNAPSHOT_HISTORY_LIMIT + 3; i++) history = appendSnapshot(history, make(i));
    expect(history).toHaveLength(SNAPSHOT_HISTORY_LIMIT);
    expect(history[history.length - 1].observed_at).toBe(make(SNAPSHOT_HISTORY_LIMIT + 2).observed_at);
  });
});

describe("readSnapshots / writeSnapshots", () => {
  const snap = buildSnapshot({ balances: [xlm], usdPerXlm: 0.5, observedAt: OBSERVED, fetchedAt: FETCHED });

  it("round-trips history per address", () => {
    const storage = memoryStorage();
    expect(writeSnapshots(ADDRESS, [snap], storage)).toBe(true);
    expect(readSnapshots(ADDRESS, storage)).toEqual([snap]);
  });

  it("drops corrupt entries and tolerates bad JSON", () => {
    expect(readSnapshots(ADDRESS, memoryStorage("{bad"))).toEqual([]);
    expect(readSnapshots(ADDRESS, memoryStorage(JSON.stringify([{ nope: true }, snap])))).toEqual([snap]);
  });

  it("reports unavailable storage without throwing", () => {
    expect(readSnapshots(ADDRESS, null)).toEqual([]);
    expect(writeSnapshots(ADDRESS, [snap], null)).toBe(false);
  });
});
