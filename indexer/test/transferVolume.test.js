/**
 * Unit tests for transferVolume.js classic token transfer volume by ledger interval.
 * Closes #1063
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeTransferVolume } from "../src/transferVolume.js";

const ISSUER = "G" + "I".repeat(55);
const ALICE = "G" + "A".repeat(55);
const BOB = "G" + "B".repeat(55);

const USDC = { asset_code: "USDC", asset_issuer: ISSUER };

// Horizon-style payment operation, reduced to the fields the summary reads
function payment(ledger, from, to, amount, asset = USDC) {
  return { type: "payment", ledger, from, to, amount, asset };
}

describe("summarizeTransferVolume — normal path", () => {
  it("counts and sums ordinary transfers into the interval bucket", () => {
    const ops = [payment(100, ALICE, BOB, "10.0000000"), payment(105, ALICE, BOB, "2.5000000")];
    const buckets = summarizeTransferVolume(ops, { asset: USDC, interval: 10 });
    assert.deepEqual(buckets, [
      {
        ledger_start: 100,
        ledger_end: 109,
        transfer_count: 2,
        total_amount: "12.5000000",
        mint_count: 0,
        burn_count: 0,
        self_transfer_count: 0,
      },
    ]);
  });

  it("splits operations across consecutive interval buckets in ledger order", () => {
    const ops = [payment(115, ALICE, BOB, "1.0000000"), payment(100, ALICE, BOB, "1.0000000")];
    const buckets = summarizeTransferVolume(ops, { asset: USDC, interval: 10 });
    assert.deepEqual(
      buckets.map((b) => b.ledger_start),
      [100, 110],
    );
  });

  it("ignores operations for other assets and non-payment operation types", () => {
    const other = payment(100, ALICE, BOB, "5.0000000", { asset_code: "EURC", asset_issuer: ISSUER });
    const invoke = { type: "invoke_host_function", ledger: 100 };
    const buckets = summarizeTransferVolume([other, invoke], { asset: USDC, interval: 10 });
    assert.deepEqual(buckets, []);
  });
});

describe("summarizeTransferVolume — mint, burn and self-transfer handling", () => {
  it("counts a payment from the issuer as a mint, not a transfer amount of the issuer", () => {
    const buckets = summarizeTransferVolume(
      [payment(100, ISSUER, ALICE, "50.0000000")],
      { asset: USDC, interval: 10 },
    );
    assert.equal(buckets[0].mint_count, 1);
    assert.equal(buckets[0].burn_count, 0);
    assert.equal(buckets[0].total_amount, "50.0000000");
  });

  it("counts a payment to the issuer as a burn", () => {
    const buckets = summarizeTransferVolume(
      [payment(100, ALICE, ISSUER, "20.0000000")],
      { asset: USDC, interval: 10 },
    );
    assert.equal(buckets[0].burn_count, 1);
    assert.equal(buckets[0].mint_count, 0);
  });

  it("counts a payment where sender and receiver match as a self-transfer", () => {
    const buckets = summarizeTransferVolume(
      [payment(100, ALICE, ALICE, "3.0000000")],
      { asset: USDC, interval: 10 },
    );
    assert.equal(buckets[0].self_transfer_count, 1);
    assert.equal(buckets[0].transfer_count, 1);
  });
});

describe("summarizeTransferVolume — empty and boundary input", () => {
  it("returns an empty array when there are no operations", () => {
    assert.deepEqual(summarizeTransferVolume([], { asset: USDC, interval: 10 }), []);
  });

  it("places an operation exactly on a bucket boundary in the next bucket", () => {
    const buckets = summarizeTransferVolume(
      [payment(110, ALICE, BOB, "1.0000000")],
      { asset: USDC, interval: 10 },
    );
    assert.equal(buckets[0].ledger_start, 110);
  });

  it("keeps full stroop precision when summing amounts", () => {
    const ops = [payment(100, ALICE, BOB, "0.0000001"), payment(100, ALICE, BOB, "0.0000002")];
    const [bucket] = summarizeTransferVolume(ops, { asset: USDC, interval: 10 });
    assert.equal(bucket.total_amount, "0.0000003");
  });
});

describe("summarizeTransferVolume — invalid input and failure", () => {
  it("throws TypeError when operations is not an array", () => {
    assert.throws(() => summarizeTransferVolume(undefined, { asset: USDC, interval: 10 }), TypeError);
  });

  it("rejects a non-positive interval", () => {
    assert.throws(() => summarizeTransferVolume([], { asset: USDC, interval: 0 }), RangeError);
  });

  it("rejects a malformed amount", () => {
    assert.throws(
      () => summarizeTransferVolume([payment(100, ALICE, BOB, "ten")], { asset: USDC, interval: 10 }),
      RangeError,
    );
  });
});
