/**
 * Unit tests for liquidityPools.js liquidity-pool position summaries.
 * Closes #1062
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizePoolShares } from "../src/liquidityPools.js";

const POOL_ID = "a".repeat(64);

// Horizon-style pool-share balance entry as returned in /accounts/:id balances
const SHARE_BALANCE = {
  asset_type: "liquidity_pool_shares",
  liquidity_pool_id: POOL_ID,
  balance: "100.0000000",
};

// Horizon-style liquidity pool record for the same pool
const POOL = {
  id: POOL_ID,
  total_shares: "1000.0000000",
  last_modified_ledger: 52000000,
  reserves: [
    { asset: "native", amount: "5000.0000000" },
    { asset: "USDC:GISSUER", amount: "2500.0000000" },
  ],
};

describe("summarizePoolShares — normal path", () => {
  it("returns one summary per pool-share balance", () => {
    const [summary] = summarizePoolShares([SHARE_BALANCE], { [POOL_ID]: POOL });
    assert.equal(summary.liquidity_pool_id, POOL_ID);
    assert.equal(summary.share_balance, "100.0000000");
  });

  it("computes underlying amounts as share fraction of each reserve", () => {
    const [summary] = summarizePoolShares([SHARE_BALANCE], { [POOL_ID]: POOL });
    assert.deepEqual(summary.reserves, [
      { asset_code: "XLM", asset_issuer: null, underlying_amount: "500.0000000" },
      { asset_code: "USDC", asset_issuer: "GISSUER", underlying_amount: "250.0000000" },
    ]);
  });

  it("links the calculation ledger to the pool's last modified ledger", () => {
    const [summary] = summarizePoolShares([SHARE_BALANCE], { [POOL_ID]: POOL });
    assert.equal(summary.calculation_ledger, 52000000);
  });

  it("ignores non-pool balances such as native XLM and credit assets", () => {
    const balances = [
      { asset_type: "native", balance: "10.0000000" },
      { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "1.0000000" },
      SHARE_BALANCE,
    ];
    const summaries = summarizePoolShares(balances, { [POOL_ID]: POOL });
    assert.equal(summaries.length, 1);
  });
});

describe("summarizePoolShares — empty and boundary input", () => {
  it("returns an empty array when the account holds no pool shares", () => {
    assert.deepEqual(summarizePoolShares([], {}), []);
  });

  it("returns zero underlying amounts for a zero share balance", () => {
    const balance = { ...SHARE_BALANCE, balance: "0.0000000" };
    const [summary] = summarizePoolShares([balance], { [POOL_ID]: POOL });
    assert.equal(summary.reserves[0].underlying_amount, "0.0000000");
  });

  it("returns the full reserves when the account owns all pool shares", () => {
    const balance = { ...SHARE_BALANCE, balance: "1000.0000000" };
    const [summary] = summarizePoolShares([balance], { [POOL_ID]: POOL });
    assert.equal(summary.reserves[0].underlying_amount, "5000.0000000");
  });
});

describe("summarizePoolShares — invalid input and failure", () => {
  it("throws TypeError when balances is not an array", () => {
    assert.throws(() => summarizePoolShares(null, {}), TypeError);
  });

  it("throws when a pool-share balance has no matching pool record", () => {
    assert.throws(() => summarizePoolShares([SHARE_BALANCE], {}), /pool .* not found/i);
  });

  it("rejects a non-numeric share balance", () => {
    const balance = { ...SHARE_BALANCE, balance: "abc" };
    assert.throws(() => summarizePoolShares([balance], { [POOL_ID]: POOL }), RangeError);
  });
});
