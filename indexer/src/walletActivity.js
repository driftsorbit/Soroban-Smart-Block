// Pure helpers for account-activity comparison (issue #1046) and counterparty
// summaries (issue #1047). No DB or network access happens here: callers pass
// in event rows from db.getWalletEvents and get plain objects back.

// Event columns that feed the summaries. Returned in every comparison response
// so clients can see exactly which fields a figure was derived from.
export const FIELDS_USED = ["contract_id", "function", "ledger", "created_at"];

const PUBLIC_ACCOUNT_RE = /^G[A-Z2-7]{55}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPublicAccountAddress(value) {
  return typeof value === "string" && PUBLIC_ACCOUNT_RE.test(value);
}

// Validates the optional YYYY-MM-DD interval shared by the wallet routes.
// Throws a RangeError with a client-facing message on bad input.
export function parseInterval({ from, to } = {}) {
  for (const [name, value] of [["from", from], ["to", to]]) {
    if (value === undefined) continue;
    if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
      throw new RangeError(`${name} must be a YYYY-MM-DD date`);
    }
  }
  if (from && to && from > to) {
    throw new RangeError("from must be on or before to");
  }
  return { from: from ?? null, to: to ?? null };
}

export function summarizeActivity(events) {
  const contractIds = new Set();
  const functionCounts = {};
  let firstLedger = null;
  let lastLedger = null;

  for (const event of events) {
    contractIds.add(event.contract_id);
    functionCounts[event.function] = (functionCounts[event.function] ?? 0) + 1;
    const ledger = Number(event.ledger);
    firstLedger = firstLedger === null ? ledger : Math.min(firstLedger, ledger);
    lastLedger = lastLedger === null ? ledger : Math.max(lastLedger, ledger);
  }

  return {
    event_count: events.length,
    contract_count: contractIds.size,
    contract_ids: [...contractIds].sort(),
    function_counts: functionCounts,
    first_ledger: firstLedger,
    last_ledger: lastLedger,
  };
}

// Counterparties are Stellar addresses (G... or C...) that appear in an event's
// topics or data, excluding the account being summarised. This is a textual
// scan, so it can also pick up an address that is only referenced, not used.
const STRKEY_RE = /\b[GC][A-Z2-7]{55}\b/g;
const MAX_DRILLDOWN_IDS = 10;
const DEFAULT_SUMMARY_LIMIT = 10;

export const MAX_SUMMARY_LIMIT = 50;

export function extractCounterparties(event, account) {
  const text = `${JSON.stringify(event.raw_topics ?? null)} ${event.raw_data ?? ""}`;
  const found = new Set(text.match(STRKEY_RE) ?? []);
  found.delete(account);
  return [...found];
}

function bumpGroup(groups, key, event) {
  let group = groups.get(key);
  if (!group) {
    group = { key, count: 0, tx_hashes: new Set(), event_seqs: [] };
    groups.set(key, group);
  }
  group.count += 1;
  if (event.tx_hash && group.tx_hashes.size < MAX_DRILLDOWN_IDS) group.tx_hashes.add(event.tx_hash);
  if (group.event_seqs.length < MAX_DRILLDOWN_IDS) group.event_seqs.push(Number(event.seq));
}

function topGroups(groups, limit, keyName) {
  return [...groups.values()]
    .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key))
    .slice(0, limit)
    .map((group) => ({
      [keyName]: group.key,
      count: group.count,
      tx_hashes: [...group.tx_hashes],
      event_seqs: group.event_seqs,
    }));
}

// Most-interacted contracts and counterparties for one account. Each entry
// carries tx_hashes and event_seqs (capped at 10) so clients can drill down
// to the source transactions and events.
export function summarizeCounterparties(events, account, { limit = DEFAULT_SUMMARY_LIMIT } = {}) {
  const contracts = new Map();
  const counterparties = new Map();

  for (const event of events) {
    bumpGroup(contracts, event.contract_id, event);
    for (const address of extractCounterparties(event, account)) {
      bumpGroup(counterparties, address, event);
    }
  }

  return {
    contracts: topGroups(contracts, limit, "contract_id"),
    counterparties: topGroups(counterparties, limit, "address"),
  };
}

export function parseSummaryLimit(value) {
  if (value === undefined) return DEFAULT_SUMMARY_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SUMMARY_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_SUMMARY_LIMIT}`);
  }
  return limit;
}

export const MIN_WORKSPACE_ACCOUNTS = 2;
export const MAX_WORKSPACE_ACCOUNTS = 10;

// Validates the account list for a review workspace (#1048). Addresses must be
// distinct public accounts; the server keeps no record of the list.
export function parseWorkspaceAddresses(value) {
  if (!Array.isArray(value)) {
    throw new RangeError("addresses must be an array of public account addresses");
  }
  if (value.length < MIN_WORKSPACE_ACCOUNTS || value.length > MAX_WORKSPACE_ACCOUNTS) {
    throw new RangeError(
      `addresses must contain between ${MIN_WORKSPACE_ACCOUNTS} and ${MAX_WORKSPACE_ACCOUNTS} accounts`,
    );
  }
  const invalid = value.filter((address) => !isPublicAccountAddress(address));
  if (invalid.length) {
    throw new RangeError(`addresses contains invalid public account addresses: ${invalid.join(", ")}`);
  }
  if (new Set(value).size !== value.length) {
    throw new RangeError("addresses must be distinct");
  }
  return value;
}

// Builds the per-account view for a review workspace from already-fetched
// events. Each account gets an activity summary and its counterparty ranking.
export function buildWorkspaceSummary(entries, { limit = DEFAULT_SUMMARY_LIMIT } = {}) {
  return {
    accounts: entries.map(({ address, events }) => ({
      address,
      activity: summarizeActivity(events),
      ...summarizeCounterparties(events, address, { limit }),
    })),
    fields_used: FIELDS_USED,
  };
}

export function compareAccountActivity(left, right) {
  const leftSummary = summarizeActivity(left.events);
  const rightSummary = summarizeActivity(right.events);
  const rightContracts = new Set(rightSummary.contract_ids);
  const sharedContractIds = leftSummary.contract_ids.filter((id) => rightContracts.has(id));

  return {
    accounts: [
      { address: left.address, ...leftSummary },
      { address: right.address, ...rightSummary },
    ],
    shared_contract_ids: sharedContractIds,
    fields_used: FIELDS_USED,
  };
}
