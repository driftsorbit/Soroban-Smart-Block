// Issue #1058 — per-function decode coverage over a ledger range.
//
// An event counts as successfully decoded when the decoder resolved it against
// a contract ABI or on-chain spec (decode_status 'verified' or 'unverified').
// 'heuristic' events were guessed without a spec and are not counted as decoded.

export const DECODED_STATUSES = ["verified", "unverified"];

export function parseLedgerRange(query) {
  const from = Number(query.from_ledger);
  const to = Number(query.to_ledger);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < 1) {
    return { error: "from_ledger and to_ledger must be positive integers" };
  }
  if (from > to) {
    return { error: "from_ledger must be less than or equal to to_ledger" };
  }
  return { from, to };
}

function ratio(decoded, total) {
  if (total === 0) return null;
  return Math.round((decoded / total) * 10000) / 10000;
}

// rows: [{ function, total, decoded }] as returned by db.getDecodeCoverageByFunction.
export function buildDecodeCoverage(rows) {
  const functions = rows.map((r) => ({
    function: r.function,
    total: Number(r.total),
    decoded: Number(r.decoded),
    decode_share: ratio(Number(r.decoded), Number(r.total)),
  }));
  const total = functions.reduce((sum, f) => sum + f.total, 0);
  const decoded = functions.reduce((sum, f) => sum + f.decoded, 0);
  return { total, decoded, decode_share: ratio(decoded, total), functions };
}
