/**
 * Shareable explorer filter state (#1038).
 *
 * Network, ledger range, contract and function filters round-trip through the
 * URL query string so a view can be restored from a link. Parsing never
 * throws: invalid values are dropped and reported in `errors` so the caller
 * can show them instead of silently applying a bad filter.
 */

export const EXPLORER_NETWORKS = ["mainnet", "testnet", "futurenet"] as const;
export type ExplorerNetwork = (typeof EXPLORER_NETWORKS)[number];

export interface ExplorerFilters {
  network: ExplorerNetwork | null;
  fromLedger: number | null;
  toLedger: number | null;
  contract: string;
  fn: string;
}

export interface ParsedExplorerFilters {
  filters: ExplorerFilters;
  errors: string[];
}

/** Stellar contract strkey: C followed by 55 base32 characters. */
const CONTRACT_RE = /^C[A-Z2-7]{55}$/;
/** Soroban Symbol: letters, digits and underscores, max 32 characters. */
const FN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
/** Ledger sequences are positive integers that fit in 32 bits. */
const MAX_LEDGER = 0xffffffff;

function parseLedger(raw: string | null): number | null | "invalid" {
  if (raw === null || raw === "") return null;
  if (!/^\d+$/.test(raw)) return "invalid";
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LEDGER) return "invalid";
  return n;
}

export function parseExplorerFilters(params: URLSearchParams): ParsedExplorerFilters {
  const errors: string[] = [];
  const filters: ExplorerFilters = {
    network: null,
    fromLedger: null,
    toLedger: null,
    contract: "",
    fn: "",
  };

  const network = params.get("network");
  if (network) {
    if ((EXPLORER_NETWORKS as readonly string[]).includes(network)) {
      filters.network = network as ExplorerNetwork;
    } else {
      errors.push(`Unknown network "${network}"`);
    }
  }

  const from = parseLedger(params.get("from_ledger"));
  const to = parseLedger(params.get("to_ledger"));
  if (from === "invalid") errors.push("from_ledger must be a positive ledger number");
  if (to === "invalid") errors.push("to_ledger must be a positive ledger number");
  if (from !== "invalid") filters.fromLedger = from;
  if (to !== "invalid") filters.toLedger = to;
  if (filters.fromLedger !== null && filters.toLedger !== null && filters.fromLedger > filters.toLedger) {
    errors.push("from_ledger must not be greater than to_ledger");
    filters.fromLedger = null;
    filters.toLedger = null;
  }

  const contract = params.get("contract") ?? "";
  if (contract) {
    if (CONTRACT_RE.test(contract)) filters.contract = contract;
    else errors.push("contract must be a valid C... contract address");
  }

  const fn = params.get("fn") ?? "";
  if (fn) {
    if (FN_RE.test(fn)) filters.fn = fn;
    else errors.push("fn must be a valid Soroban function name");
  }

  return { filters, errors };
}

/** Serialise filters back to a query string. Empty fields are omitted. */
export function serializeExplorerFilters(filters: ExplorerFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.network) params.set("network", filters.network);
  if (filters.fromLedger !== null) params.set("from_ledger", String(filters.fromLedger));
  if (filters.toLedger !== null) params.set("to_ledger", String(filters.toLedger));
  if (filters.contract) params.set("contract", filters.contract);
  if (filters.fn) params.set("fn", filters.fn);
  return params;
}

/** Keep only events whose ledger falls inside the inclusive range. */
export function filterByLedgerRange<T extends { ledger: number }>(
  events: T[],
  fromLedger: number | null,
  toLedger: number | null,
): T[] {
  if (fromLedger === null && toLedger === null) return events;
  return events.filter(
    (ev) =>
      (fromLedger === null || ev.ledger >= fromLedger) &&
      (toLedger === null || ev.ledger <= toLedger),
  );
}
