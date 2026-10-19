import { describe, expect, it } from "vitest";
import { DEFAULT_DUST_THRESHOLD, isDust, parseDustThreshold, partitionByDust } from "./dustFilter";

describe("parseDustThreshold", () => {
  it("accepts zero and decimal thresholds", () => {
    expect(parseDustThreshold("0")).toEqual({ ok: true, value: 0 });
    expect(parseDustThreshold(" 0.5 ")).toEqual({ ok: true, value: 0.5 });
  });

  it("rejects empty, non-numeric, negative and out-of-range input", () => {
    expect(parseDustThreshold("").ok).toBe(false);
    expect(parseDustThreshold("abc").ok).toBe(false);
    expect(parseDustThreshold("-1").ok).toBe(false);
    expect(parseDustThreshold("1e30").ok).toBe(false);
  });

  it("provides a default that itself parses", () => {
    expect(parseDustThreshold(DEFAULT_DUST_THRESHOLD).ok).toBe(true);
  });
});

describe("isDust", () => {
  it("treats balances strictly below the threshold as dust", () => {
    expect(isDust("0.5", 1)).toBe(true);
    expect(isDust("1", 1)).toBe(false);
    expect(isDust("0", 0)).toBe(false);
  });

  it("never treats unparseable balances as dust", () => {
    expect(isDust("n/a", 1)).toBe(false);
  });
});

describe("partitionByDust", () => {
  const rows = [
    { code: "AAA", balance: "0.0000001" },
    { code: "BBB", balance: "250" },
    { code: "CCC", balance: "2" },
    { code: "DDD", balance: "bogus" },
  ];

  it("splits rows into visible and dust while preserving order and total count", () => {
    const { visible, dust } = partitionByDust(rows, 3);
    expect(visible.map((r) => r.code)).toEqual(["BBB", "DDD"]);
    expect(dust.map((r) => r.code)).toEqual(["AAA", "CCC"]);
    expect(visible.length + dust.length).toBe(rows.length);
  });

  it("hides nothing when the threshold is zero", () => {
    expect(partitionByDust(rows, 0).dust).toEqual([]);
  });
});
