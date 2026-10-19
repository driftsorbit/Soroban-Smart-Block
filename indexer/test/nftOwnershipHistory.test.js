/**
 * Unit tests for nftOwnershipHistory.js NFT ownership history with provenance.
 * Closes #1065
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOwnershipHistory } from "../src/nftOwnershipHistory.js";

const ALICE = "G" + "A".repeat(55);
const BOB = "G" + "B".repeat(55);
const CAROL = "G" + "C".repeat(55);
const TOKEN = { contract_id: "C" + "T".repeat(55), token_id: "1" };

// Ownership transfer event, reduced to the fields the history reads
function transfer(ledger, eventIndex, from, to) {
  return {
    ledger,
    event_index: eventIndex,
    tx_hash: `tx${ledger}${eventIndex}`.padEnd(64, "0"),
    event_id: `${ledger}-${eventIndex}`,
    from,
    to,
    token: TOKEN,
  };
}

describe("buildOwnershipHistory — normal path", () => {
  it("returns transitions in ledger order", () => {
    const events = [transfer(200, 0, BOB, CAROL), transfer(100, 0, ALICE, BOB)];
    const history = buildOwnershipHistory(events);
    assert.deepEqual(
      history.map((h) => [h.from, h.to]),
      [
        [ALICE, BOB],
        [BOB, CAROL],
      ],
    );
  });

  it("orders events within the same ledger by event index", () => {
    const events = [transfer(100, 2, BOB, CAROL), transfer(100, 1, ALICE, BOB)];
    const history = buildOwnershipHistory(events);
    assert.deepEqual(
      history.map((h) => h.event_id),
      ["100-1", "100-2"],
    );
  });

  it("links each transition to its transaction hash and event id", () => {
    const [entry] = buildOwnershipHistory([transfer(100, 0, ALICE, BOB)]);
    assert.equal(entry.tx_hash, "tx100000".padEnd(64, "0"));
    assert.equal(entry.event_id, "100-0");
    assert.equal(entry.ledger, 100);
  });

  it("includes the token identity on every transition", () => {
    const history = buildOwnershipHistory([transfer(100, 0, ALICE, BOB)]);
    assert.deepEqual(history[0].token, TOKEN);
  });
});

describe("buildOwnershipHistory — empty and boundary input", () => {
  it("returns an empty array when the token has no transfers", () => {
    assert.deepEqual(buildOwnershipHistory([]), []);
  });

  it("returns a single entry for a single transfer", () => {
    const history = buildOwnershipHistory([transfer(100, 0, ALICE, BOB)]);
    assert.equal(history.length, 1);
  });

  it("does not mutate the input array", () => {
    const events = [transfer(200, 0, BOB, CAROL), transfer(100, 0, ALICE, BOB)];
    const snapshot = events.map((e) => e.ledger);
    buildOwnershipHistory(events);
    assert.deepEqual(
      events.map((e) => e.ledger),
      snapshot,
    );
  });
});

describe("buildOwnershipHistory — invalid input and failure", () => {
  it("throws TypeError when events is not an array", () => {
    assert.throws(() => buildOwnershipHistory(null), TypeError);
  });

  it("throws when a transfer is missing its ledger", () => {
    const bad = { ...transfer(100, 0, ALICE, BOB), ledger: undefined };
    assert.throws(() => buildOwnershipHistory([bad]), /ledger/i);
  });

  it("throws when a transfer is missing its transaction hash", () => {
    const bad = { ...transfer(100, 0, ALICE, BOB), tx_hash: undefined };
    assert.throws(() => buildOwnershipHistory([bad]), /tx_hash/i);
  });

  it("throws when transfers for different tokens are mixed", () => {
    const other = { ...transfer(101, 0, BOB, CAROL), token: { ...TOKEN, token_id: "2" } };
    assert.throws(() => buildOwnershipHistory([transfer(100, 0, ALICE, BOB), other]), /token/i);
  });
});
