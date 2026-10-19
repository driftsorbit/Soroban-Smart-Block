// Contract upgrade lineage (issue #1056).
//
// Combines the WASM hashes observed through upgrade events with the ABI
// metadata versions recorded in contract_versions, so a caller can see which
// metadata version was in force when each deployed WASM became active.
//
// Pure: callers supply the rows, so no database access happens here.

function toLedger(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The metadata version in force at a ledger is the highest abi_version whose
// min_ledger is at or before that ledger.
function metadataVersionAt(metadataVersions, ledger) {
  if (ledger === null) return null;
  let active = null;
  for (const v of metadataVersions) {
    if (v.min_ledger !== null && v.min_ledger <= ledger) active = v.abi_version;
  }
  return active;
}

/**
 * @param {Array<{abi_version: number, min_ledger?: number|string|null, created_at?: string}>} versions
 *        Rows from contract_versions for one contract.
 * @param {Array<{ledger: number|string, tx_hash?: string|null, upgrade_info: {oldHash?: string|null, newHash?: string|null}}>} upgrades
 *        Rows from events where upgrade_info is set, in any order.
 * @returns {{
 *   wasm_versions: Array<{wasm_hash: string, activated_ledger: number|null, activated_tx_hash: string|null,
 *                          superseded_ledger: number|null, is_current: boolean, metadata_abi_version: number|null}>,
 *   metadata_versions: Array<{abi_version: number, min_ledger: number|null, created_at: string|null}>,
 *   upgrade_count: number
 * }}
 */
export function buildUpgradeLineage(versions = [], upgrades = []) {
  const metadata_versions = versions
    .map((v) => ({
      abi_version: Number(v.abi_version),
      min_ledger: toLedger(v.min_ledger),
      created_at: v.created_at ?? null,
    }))
    .sort((a, b) => a.abi_version - b.abi_version);

  const ordered = upgrades
    .map((u) => ({
      ledger: toLedger(u.ledger),
      tx_hash: u.tx_hash ?? null,
      oldHash: u.upgrade_info?.oldHash ?? null,
      newHash: u.upgrade_info?.newHash ?? null,
    }))
    .filter((u) => u.newHash && u.ledger !== null)
    .sort((a, b) => a.ledger - b.ledger);

  const wasm_versions = [];
  if (ordered.length > 0 && ordered[0].oldHash) {
    // The WASM that was running before the first observed upgrade.
    wasm_versions.push({
      wasm_hash: ordered[0].oldHash,
      activated_ledger: null,
      activated_tx_hash: null,
      superseded_ledger: null,
      is_current: false,
    });
  }

  for (const u of ordered) {
    const previous = wasm_versions[wasm_versions.length - 1];
    if (previous) previous.superseded_ledger = u.ledger;
    wasm_versions.push({
      wasm_hash: u.newHash,
      activated_ledger: u.ledger,
      activated_tx_hash: u.tx_hash,
      superseded_ledger: null,
      is_current: false,
    });
  }

  if (wasm_versions.length > 0) wasm_versions[wasm_versions.length - 1].is_current = true;

  for (const w of wasm_versions) {
    w.metadata_abi_version = metadataVersionAt(metadata_versions, w.activated_ledger);
  }

  return { wasm_versions, metadata_versions, upgrade_count: ordered.length };
}
