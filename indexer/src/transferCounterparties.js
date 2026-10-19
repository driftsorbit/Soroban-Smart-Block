/**
 * Largest senders and recipients for a token transfer range (#1069).
 *
 * Amounts are summed as BigInt so totals stay exact. Each address gets a
 * public account link so the UI can open its page directly.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

function rank(map, limit) {
  return [...map.entries()]
    .map(([address, { total, count }]) => ({
      address,
      total_raw: total.toString(),
      transfers: count,
      account_url: `/account/${address}`,
    }))
    .sort((a, b) => {
      const diff = BigInt(b.total_raw) - BigInt(a.total_raw);
      if (diff !== 0n) return diff > 0n ? 1 : -1;
      return a.address.localeCompare(b.address);
    })
    .slice(0, limit);
}

/**
 * @param {Array<{from: string, to: string, amount: string}>} transfers
 * @param {{ limit?: number }} [opts]
 * @returns {{ senders: object[], recipients: object[], transfers_considered: number, transfers_skipped: number, limit: number }}
 */
export function summarizeCounterparties(transfers, { limit = DEFAULT_LIMIT } = {}) {
  const safeLimit = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT;
  const senders = new Map();
  const recipients = new Map();
  let considered = 0;
  let skipped = 0;

  const add = (map, address, amount) => {
    const entry = map.get(address) ?? { total: 0n, count: 0 };
    entry.total += amount;
    entry.count += 1;
    map.set(address, entry);
  };

  for (const t of Array.isArray(transfers) ? transfers : []) {
    const valid =
      t && typeof t.from === "string" && t.from && typeof t.to === "string" && t.to && /^\d+$/.test(String(t.amount ?? ""));
    if (!valid) {
      skipped++;
      continue;
    }
    const amount = BigInt(t.amount);
    add(senders, t.from, amount);
    add(recipients, t.to, amount);
    considered++;
  }

  return {
    senders: rank(senders, safeLimit),
    recipients: rank(recipients, safeLimit),
    transfers_considered: considered,
    transfers_skipped: skipped,
    limit: safeLimit,
  };
}
