/**
 * Token supply change history for mint and burn events (#1067).
 *
 * Each point is backed by a source event (seq / tx_hash) so the chart can link
 * back to the event. Coverage describes the ledger range the points came from
 * and whether any input rows had to be skipped, so gaps are visible.
 */

const KINDS = { mint: 1n, burn: -1n };

/**
 * @param {Array<{seq: number|string, ledger: number|string, function: string, amount: string, tx_hash?: string}>} events
 * @param {{ limit?: number }} [opts]
 * @returns {{ points: object[], coverage: object }}
 */
export function buildSupplyHistory(events, { limit = 500 } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const parsed = [];
  let skipped = 0;

  for (const row of rows) {
    const sign = KINDS[row?.function];
    if (sign === undefined || !/^\d+$/.test(String(row.amount ?? ""))) {
      skipped++;
      continue;
    }
    parsed.push({
      seq: Number(row.seq),
      ledger: Number(row.ledger),
      kind: row.function,
      delta: sign * BigInt(row.amount),
      tx_hash: row.tx_hash ?? null,
    });
  }

  parsed.sort((a, b) => a.ledger - b.ledger || a.seq - b.seq);

  let supply = 0n;
  let incomplete = false;
  const points = parsed.map((p) => {
    supply += p.delta;
    if (supply < 0n) incomplete = true;
    return {
      ledger: p.ledger,
      event_seq: p.seq,
      tx_hash: p.tx_hash,
      kind: p.kind,
      delta_raw: p.delta.toString(),
      supply_after_raw: supply.toString(),
    };
  });

  const truncated = points.length > limit;
  const shown = truncated ? points.slice(-limit) : points;

  return {
    points: shown,
    coverage: {
      first_ledger: parsed.length ? parsed[0].ledger : null,
      last_ledger: parsed.length ? parsed[parsed.length - 1].ledger : null,
      events_considered: parsed.length,
      events_skipped: skipped,
      truncated,
      // A negative running supply means earlier mints are missing from the
      // indexed range, so the series cannot be trusted as a full history.
      incomplete,
    },
  };
}
