/**
 * tokenFlow.ts — classify SEP-41 `transfer` events relative to one wallet (#1042).
 *
 * A SEP-41 transfer event carries `transfer` as topic 0, the sender as topic 1,
 * the recipient as topic 2, and the amount as the event data. Each is an XDR
 * ScVal; we decode them here so the wallet page can split activity into
 * incoming, outgoing and self-transfers, each linked back to its source event.
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { DecodedEvent } from "../api";

export interface TokenTransfer {
  /** Source event id (canonical when present) and feed sequence, used to link back to the event. */
  eventId: string;
  seq: number;
  txHash?: string;
  contractId: string;
  from: string;
  to: string;
  /** Raw integer amount as a string (token base units, no decimal scaling). */
  amount: string;
}

export interface TokenFlowSummary {
  incoming: TokenTransfer[];
  outgoing: TokenTransfer[];
  self: TokenTransfer[];
}

function decodeScVal(base64: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(base64, "base64"));
}

/** Returns the decoded transfer for a SEP-41 `transfer` event, or null for anything else. */
export function extractTransfer(event: DecodedEvent): TokenTransfer | null {
  const topics = event.raw_topics ?? [];
  if (topics.length < 3 || !event.raw_data) return null;
  try {
    if (decodeScVal(topics[0]) !== "transfer") return null;
    const from = decodeScVal(topics[1]);
    const to = decodeScVal(topics[2]);
    const amount = decodeScVal(event.raw_data);
    if (typeof from !== "string" || typeof to !== "string") return null;
    if (typeof amount !== "bigint" && typeof amount !== "number") return null;
    return {
      eventId: event.event_id ?? `${event.ledger}:${event.seq}`,
      seq: event.seq,
      txHash: event.tx_hash,
      contractId: event.contract_id,
      from,
      to,
      amount: amount.toString(),
    };
  } catch {
    // Malformed XDR is skipped rather than failing the whole wallet page.
    return null;
  }
}

/** Splits transfers involving `address` into incoming, outgoing and self-transfers. */
export function classifyTokenFlows(events: DecodedEvent[], address: string): TokenFlowSummary {
  const summary: TokenFlowSummary = { incoming: [], outgoing: [], self: [] };
  if (!address) return summary;
  for (const event of events) {
    const transfer = extractTransfer(event);
    if (!transfer) continue;
    const isFrom = transfer.from === address;
    const isTo = transfer.to === address;
    if (isFrom && isTo) summary.self.push(transfer);
    else if (isFrom) summary.outgoing.push(transfer);
    else if (isTo) summary.incoming.push(transfer);
  }
  return summary;
}
