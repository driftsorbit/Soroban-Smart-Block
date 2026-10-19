/**
 * Unit tests for transfer counterparty summaries. Closes #1069
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeCounterparties } from "../src/transferCounterparties.js";

const A = "GA22K667OGPC3R32NRJTNQG4KWT2OFGHNNGZ2JQMSIGLT7AFHVIOMJ43";
const B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const C = "GCFXHS4GXL6BVUCXBWXGTITROWLVYXQKQLF4YH5O5JT3YZXCYPAFBJZB";

describe("summarizeCounterparties (#1069)", () => {
  it("returns empty rankings for no transfers", () => {
    const result = summarizeCounterparties([]);
    assert.deepEqual(result.senders, []);
    assert.deepEqual(result.recipients, []);
    assert.equal(result.transfers_considered, 0);
  });

  it("ranks senders and recipients by exact total, largest first", () => {
    const result = summarizeCounterparties([
      { from: A, to: B, amount: "900000000000000000000" },
      { from: A, to: C, amount: "200000000000000000000" },
      { from: C, to: B, amount: "50" },
    ]);
    assert.deepEqual(result.senders.map((s) => [s.address, s.total_raw, s.transfers]), [
      [A, "1100000000000000000000", 2],
      [C, "50", 1],
    ]);
    assert.equal(result.recipients[0].address, B);
    assert.equal(result.recipients[0].total_raw, "900000000000000000050");
  });

  it("links each counterparty to its public account page", () => {
    const { senders } = summarizeCounterparties([{ from: A, to: B, amount: "1" }]);
    assert.equal(senders[0].account_url, `/account/${A}`);
  });

  it("breaks ties by address so ordering is deterministic", () => {
    const { senders } = summarizeCounterparties([
      { from: C, to: A, amount: "5" },
      { from: B, to: A, amount: "5" },
    ]);
    assert.deepEqual(senders.map((s) => s.address), [B, C]);
  });

  it("skips malformed rows and counts them", () => {
    const result = summarizeCounterparties([
      { from: A, to: B, amount: "1.5" },
      { from: "", to: B, amount: "1" },
      { from: A, to: B, amount: "-1" },
      null,
      { from: A, to: B, amount: "7" },
    ]);
    assert.equal(result.transfers_skipped, 4);
    assert.equal(result.transfers_considered, 1);
    assert.equal(result.senders[0].total_raw, "7");
  });

  it("applies the limit and clamps out-of-range values", () => {
    const rows = [A, B, C].map((from, i) => ({ from, to: "GZ", amount: String(i + 1) }));
    assert.equal(summarizeCounterparties(rows, { limit: 2 }).senders.length, 2);
    assert.equal(summarizeCounterparties(rows, { limit: 0 }).limit, 10);
    assert.equal(summarizeCounterparties(rows, { limit: 500 }).limit, 100);
  });
});
