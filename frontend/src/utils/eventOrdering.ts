import type { DecodedEvent } from "../api";

/**
 * Position of an event among the events of the same transaction (#1037).
 * `position` is 1-based and `total` counts the events of that transaction.
 * Ordering comes from the indexer's event `seq`, which is assigned in chain
 * order, so `source` is always "seq".
 */
export interface TxEventOrder {
  position: number;
  total: number;
  source: "seq";
}

/**
 * Group events by transaction hash and number each group by ascending `seq`.
 *
 * Only the events passed in are counted, so a transaction whose events span
 * two pages is numbered within the page it appears on. Events with no
 * `tx_hash` get no entry.
 */
export function txEventOrder(events: Pick<DecodedEvent, "seq" | "tx_hash">[]): Map<number, TxEventOrder> {
  const groups = new Map<string, number[]>();
  for (const ev of events) {
    if (!ev.tx_hash) continue;
    const seqs = groups.get(ev.tx_hash);
    if (seqs) seqs.push(ev.seq);
    else groups.set(ev.tx_hash, [ev.seq]);
  }

  const order = new Map<number, TxEventOrder>();
  for (const seqs of groups.values()) {
    seqs.sort((a, b) => a - b);
    seqs.forEach((seq, i) => order.set(seq, { position: i + 1, total: seqs.length, source: "seq" }));
  }
  return order;
}
