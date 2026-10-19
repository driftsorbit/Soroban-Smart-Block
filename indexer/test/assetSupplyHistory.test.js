/**
 * Unit tests for mint/burn supply history. Closes #1067
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSupplyHistory } from "../src/assetSupplyHistory.js";

describe("buildSupplyHistory (#1067)", () => {
  it("returns an empty series with null coverage when there are no events", () => {
    const { points, coverage } = buildSupplyHistory([]);
    assert.deepEqual(points, []);
    assert.equal(coverage.first_ledger, null);
    assert.equal(coverage.events_considered, 0);
    assert.equal(coverage.incomplete, false);
  });

  it("accumulates mints and burns in ledger order with source events", () => {
    const { points, coverage } = buildSupplyHistory([
      { seq: 2, ledger: 110, function: "burn", amount: "400", tx_hash: "b" },
      { seq: 1, ledger: 100, function: "mint", amount: "1000", tx_hash: "a" },
      { seq: 3, ledger: 120, function: "mint", amount: "50", tx_hash: "c" },
    ]);
    assert.deepEqual(
      points.map((p) => [p.event_seq, p.kind, p.supply_after_raw]),
      [
        [1, "mint", "1000"],
        [2, "burn", "600"],
        [3, "mint", "650"],
      ],
    );
    assert.equal(points[1].tx_hash, "b");
    assert.equal(coverage.first_ledger, 100);
    assert.equal(coverage.last_ledger, 120);
  });

  it("skips non-mint/burn functions and malformed amounts, and counts them", () => {
    const { points, coverage } = buildSupplyHistory([
      { seq: 1, ledger: 1, function: "transfer", amount: "5" },
      { seq: 2, ledger: 2, function: "mint", amount: "-5" },
      { seq: 3, ledger: 3, function: "mint", amount: "12.5" },
      { seq: 4, ledger: 4, function: "mint", amount: "7" },
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0].supply_after_raw, "7");
    assert.equal(coverage.events_skipped, 3);
  });

  it("marks coverage incomplete when a burn exceeds the indexed supply", () => {
    const { coverage } = buildSupplyHistory([{ seq: 1, ledger: 1, function: "burn", amount: "10" }]);
    assert.equal(coverage.incomplete, true);
  });

  it("keeps the most recent points and reports truncation", () => {
    const events = [1, 2, 3].map((n) => ({ seq: n, ledger: n, function: "mint", amount: "1" }));
    const { points, coverage } = buildSupplyHistory(events, { limit: 2 });
    assert.deepEqual(points.map((p) => p.event_seq), [2, 3]);
    assert.equal(points[1].supply_after_raw, "3");
    assert.equal(coverage.truncated, true);
  });
});
