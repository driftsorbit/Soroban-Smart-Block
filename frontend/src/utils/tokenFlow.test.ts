import { describe, expect, it } from "vitest";
import { Address, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { DecodedEvent } from "../api";
import { classifyTokenFlows, extractTransfer } from "./tokenFlow";

// Fixed seeds keep the addresses deterministic across runs.
const ALICE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const BOB = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function topic(value: xdr.ScVal): string {
  return value.toXDR("base64");
}

function transferEvent(from: string, to: string, amount: bigint, overrides: Partial<DecodedEvent> = {}): DecodedEvent {
  return {
    seq: 1,
    contract_id: CONTRACT,
    function: "transfer",
    ledger: 100,
    description: "transfer",
    raw_topics: [
      topic(xdr.ScVal.scvSymbol("transfer")),
      topic(Address.fromString(from).toScVal()),
      topic(Address.fromString(to).toScVal()),
    ],
    raw_data: nativeToScVal(amount, { type: "i128" }).toXDR("base64"),
    tx_hash: "tx-1",
    event_id: "evt-1",
    ...overrides,
  };
}

describe("extractTransfer", () => {
  it("decodes sender, recipient and amount from a SEP-41 transfer event", () => {
    const transfer = extractTransfer(transferEvent(ALICE, BOB, 2500n));
    expect(transfer).toEqual({
      eventId: "evt-1",
      seq: 1,
      txHash: "tx-1",
      contractId: CONTRACT,
      from: ALICE,
      to: BOB,
      amount: "2500",
    });
  });

  it("returns null for non-transfer topics", () => {
    const event = transferEvent(ALICE, BOB, 1n, {
      raw_topics: [topic(xdr.ScVal.scvSymbol("mint")), topic(Address.fromString(ALICE).toScVal()), topic(Address.fromString(BOB).toScVal())],
    });
    expect(extractTransfer(event)).toBeNull();
  });

  it("returns null when topics or data are missing", () => {
    expect(extractTransfer(transferEvent(ALICE, BOB, 1n, { raw_topics: [] }))).toBeNull();
    expect(extractTransfer(transferEvent(ALICE, BOB, 1n, { raw_data: undefined }))).toBeNull();
  });

  it("returns null instead of throwing on malformed XDR", () => {
    const event = transferEvent(ALICE, BOB, 1n, { raw_data: "not-base64-xdr!!" });
    expect(extractTransfer(event)).toBeNull();
  });

  it("falls back to ledger:seq when no canonical event id is present", () => {
    const transfer = extractTransfer(transferEvent(ALICE, BOB, 1n, { event_id: null }));
    expect(transfer?.eventId).toBe("100:1");
  });
});

describe("classifyTokenFlows", () => {
  it("splits transfers into incoming, outgoing and self buckets for the wallet", () => {
    const events = [
      transferEvent(BOB, ALICE, 10n, { event_id: "in" }),
      transferEvent(ALICE, BOB, 20n, { event_id: "out" }),
      transferEvent(ALICE, ALICE, 30n, { event_id: "self" }),
      transferEvent(BOB, CONTRACT, 40n, { event_id: "unrelated" }),
    ];
    const summary = classifyTokenFlows(events, ALICE);
    expect(summary.incoming.map((t) => t.eventId)).toEqual(["in"]);
    expect(summary.outgoing.map((t) => t.eventId)).toEqual(["out"]);
    expect(summary.self.map((t) => t.eventId)).toEqual(["self"]);
  });

  it("returns empty buckets for an empty event list or a blank address", () => {
    expect(classifyTokenFlows([], ALICE)).toEqual({ incoming: [], outgoing: [], self: [] });
    expect(classifyTokenFlows([transferEvent(ALICE, BOB, 1n)], "")).toEqual({ incoming: [], outgoing: [], self: [] });
  });
});
