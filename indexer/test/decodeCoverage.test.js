import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDecodeCoverage, DECODED_STATUSES, parseLedgerRange } from "../src/decodeCoverage.js";

// Issue #1058 — decode coverage aggregation and ledger-range validation.

describe("parseLedgerRange (#1058)", () => {
  it("accepts a valid inclusive range", () => {
    assert.deepEqual(parseLedgerRange({ from_ledger: "100", to_ledger: "200" }), { from: 100, to: 200 });
  });

  it("accepts a single-ledger range", () => {
    assert.deepEqual(parseLedgerRange({ from_ledger: "5", to_ledger: "5" }), { from: 5, to: 5 });
  });

  it("rejects missing parameters", () => {
    assert.ok(parseLedgerRange({}).error);
    assert.ok(parseLedgerRange({ from_ledger: "1" }).error);
  });

  it("rejects non-integer, zero, negative and unsafe values", () => {
    for (const bad of ["abc", "1.5", "0", "-3", "9007199254740993", ""]) {
      assert.ok(parseLedgerRange({ from_ledger: bad, to_ledger: "10" }).error, `from=${bad}`);
      assert.ok(parseLedgerRange({ from_ledger: "1", to_ledger: bad }).error, `to=${bad}`);
    }
  });

  it("rejects an inverted range", () => {
    assert.match(parseLedgerRange({ from_ledger: "10", to_ledger: "9" }).error, /less than or equal/);
  });
});

describe("buildDecodeCoverage (#1058)", () => {
  it("counts only ABI/spec-backed statuses as decoded", () => {
    assert.deepEqual(DECODED_STATUSES, ["verified", "unverified"]);
  });

  it("returns an explicit empty result when the range has no events", () => {
    assert.deepEqual(buildDecodeCoverage([]), { total: 0, decoded: 0, decode_share: null, functions: [] });
  });

  it("computes per-function and overall shares rounded to four decimals", () => {
    const result = buildDecodeCoverage([
      { function: "transfer", total: 3, decoded: 2 },
      { function: "mint", total: 4, decoded: 4 },
    ]);
    assert.equal(result.total, 7);
    assert.equal(result.decoded, 6);
    assert.equal(result.decode_share, 0.8571);
    assert.deepEqual(result.functions[0], {
      function: "transfer",
      total: 3,
      decoded: 2,
      decode_share: 0.6667,
    });
    assert.equal(result.functions[1].decode_share, 1);
  });

  it("reports a null share for a function with zero events", () => {
    const result = buildDecodeCoverage([{ function: "burn", total: 0, decoded: 0 }]);
    assert.equal(result.functions[0].decode_share, null);
    assert.equal(result.decode_share, null);
  });

  it("coerces string counts from Postgres int8 results", () => {
    const result = buildDecodeCoverage([{ function: "swap", total: "10", decoded: "5" }]);
    assert.equal(result.decode_share, 0.5);
  });
});
