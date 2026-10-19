// Issue #1061 — holder concentration for a token's current balance snapshot.
//
// top_share: fraction of total supply held by the top N holders (0..1).
// hhi: Herfindahl-Hirschman index over holder shares on a 0..10000 scale
//      (sum of squared percentage shares). Shares are rounded to basis points
//      before squaring, so the value can differ from the exact HHI by a small
//      amount when there are many holders.
// Balances are raw integer strings from token_holders. Non-positive and
// malformed balances are excluded and counted in invalid_balances.

const BPS = 10000n;

export function computeConcentration(balanceStrings, topN) {
  const balances = [];
  let invalid = 0;
  for (const raw of balanceStrings) {
    if (typeof raw === "string" && /^\d+$/.test(raw) && BigInt(raw) > 0n) {
      balances.push(BigInt(raw));
    } else {
      invalid += 1;
    }
  }
  balances.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

  const total = balances.reduce((sum, b) => sum + b, 0n);
  const top = Math.min(topN, balances.length);
  if (total === 0n) {
    return { holder_count: 0, total_balance_raw: "0", top: 0, top_share: null, hhi: null, invalid_balances: invalid };
  }

  const topSum = balances.slice(0, top).reduce((sum, b) => sum + b, 0n);
  const topShareBps = (topSum * BPS) / total;
  // HHI = sum(pct^2) = sum(bps^2) / 10^4 because pct = bps / 100.
  const hhiScaled = balances.reduce((sum, b) => {
    const bps = (b * BPS) / total;
    return sum + bps * bps;
  }, 0n);

  return {
    holder_count: balances.length,
    total_balance_raw: total.toString(),
    top,
    top_share: Number(topShareBps) / 10000,
    hhi: Number(hhiScaled / BPS),
    invalid_balances: invalid,
  };
}
