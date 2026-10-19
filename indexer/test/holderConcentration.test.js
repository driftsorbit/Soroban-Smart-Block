import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeConcentration } from "../src/holderConcentration.js";

// Issue #1061 — holder concentration metrics from a current balance snapshot.

describe("computeConcentration (#1061)", () => {
  it("returns explicit empty results when there are no holders", () => {
    assert.deepEqual(computeConcentration([], 10), {
      holder_count: 0,
      total_balance_raw: "0",
      top: 0,
      top_share: null,
      hhi: null,
      invalid_balances: 0,
    });
  });

  it("gives a single holder full concentration", () => {
    const result = computeConcentration(["500"], 10);
    assert.equal(result.top_share, 1);
    assert.equal(result.hhi, 10000);
    assert.equal(result.top, 1);
  });

  it("computes top-N share and HHI for equal holders", () => {
    const result = computeConcentration(["25", "25", "25", "25"], 2);
    assert.equal(result.holder_count, 4);
    assert.equal(result.total_balance_raw, "100");
    assert.equal(result.top_share, 0.5);
    assert.equal(result.hhi, 2500);
  });

  it("caps the top-N window at the number of holders", () => {
    const result = computeConcentration(["10", "30"], 50);
    assert.equal(result.top, 2);
    assert.equal(result.top_share, 1);
  });

  it("sorts balances before taking the top-N window", () => {
    const result = computeConcentration(["1", "9", "5"], 1);
    assert.equal(result.top_share, 0.6);
  });

  it("handles balances beyond Number precision exactly", () => {
    const big = "340282366920938463463374607431768211455";
    const result = computeConcentration([big, big], 1);
    assert.equal(result.total_balance_raw, (BigInt(big) * 2n).toString());
    assert.equal(result.top_share, 0.5);
  });

  it("excludes zero, negative, and malformed balances and counts them", () => {
    const result = computeConcentration(["0", "-4", "abc", "1.5", "", "10", null], 10);
    assert.equal(result.holder_count, 1);
    assert.equal(result.invalid_balances, 6);
    assert.equal(result.top_share, 1);
  });

  it("reports null shares when every balance is invalid or zero", () => {
    const result = computeConcentration(["0", "x"], 5);
    assert.equal(result.top_share, null);
    assert.equal(result.hhi, null);
    assert.equal(result.invalid_balances, 2);
  });
});
