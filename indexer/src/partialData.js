/**
 * Structured partial-data warnings (#1079).
 *
 * Explorer responses can be incomplete for a few well-understood reasons:
 *
 *   - the indexer is behind the network, so recently produced ledgers are
 *     not yet reflected;
 *   - an event's contract metadata (ABI) was unavailable when it was
 *     decoded, so only a heuristic/partial decode exists;
 *   - every configured RPC provider is currently unavailable, so what is
 *     served may be stale.
 *
 * Rather than letting clients guess from prose, responses carry an additive
 * `warnings` array of `{ code, message }` objects whose `code` values are a
 * small, frozen, machine-readable set. Codes are part of the public API
 * contract and only ever added, never renamed.
 */

import { getIndexerStatus } from "./health.js";
import { getProviderStats } from "./rpcMultiNode.js";
import config from "./config.js";

/** Frozen set of stable, machine-readable partial-data warning codes. */
export const PARTIAL_DATA_WARNING_CODES = Object.freeze({
  INDEXER_LAG: "indexer_lag",
  METADATA_UNAVAILABLE: "metadata_unavailable",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
});

/** Human-readable, stable message for each warning code. */
export const PARTIAL_DATA_WARNING_MESSAGES = Object.freeze({
  [PARTIAL_DATA_WARNING_CODES.INDEXER_LAG]:
    "Indexer is behind the network; recently produced events may not be included yet.",
  [PARTIAL_DATA_WARNING_CODES.METADATA_UNAVAILABLE]:
    "Some events could not be fully decoded because contract metadata (ABI) was unavailable.",
  [PARTIAL_DATA_WARNING_CODES.PROVIDER_UNAVAILABLE]:
    "All configured RPC providers are currently unavailable; results may be stale.",
});

/**
 * Build the warning list for a response from already-collected signals.
 * Pure and deterministic so it can be unit-tested without any live dependency.
 *
 * The output order is stable (lag, metadata, provider) so clients can rely on
 * it and tests are not order-flaky.
 *
 * @param {object} [signals]
 * @param {number} [signals.lagSeconds] seconds the indexer is behind
 * @param {number} [signals.lagThresholdSeconds] lag above which a warning fires
 * @param {boolean} [signals.metadataIncomplete] any event lacked ABI metadata
 * @param {boolean} [signals.providerUnavailable] all RPC providers are down
 * @returns {{ code: string, message: string }[]}
 */
export function buildPartialDataWarnings({
  lagSeconds = 0,
  lagThresholdSeconds = config.PARTIAL_DATA_LAG_THRESHOLD_SECONDS,
  metadataIncomplete = false,
  providerUnavailable = false,
} = {}) {
  const warnings = [];

  if (Number(lagSeconds) > Number(lagThresholdSeconds)) {
    warnings.push(warning(PARTIAL_DATA_WARNING_CODES.INDEXER_LAG));
  }
  if (metadataIncomplete) {
    warnings.push(warning(PARTIAL_DATA_WARNING_CODES.METADATA_UNAVAILABLE));
  }
  if (providerUnavailable) {
    warnings.push(warning(PARTIAL_DATA_WARNING_CODES.PROVIDER_UNAVAILABLE));
  }

  return warnings;
}

function warning(code) {
  return { code, message: PARTIAL_DATA_WARNING_MESSAGES[code] };
}

/**
 * True when at least one event in a page was not decoded against a verified
 * ABI — i.e. its metadata was missing, stale, or heuristic (#1079).
 *
 * @param {Array<object>} [events]
 * @returns {boolean}
 */
export function hasIncompleteMetadata(events = []) {
  if (!Array.isArray(events)) return false;
  return events.some((ev) => {
    if (!ev || typeof ev !== "object") return false;
    if (Array.isArray(ev.decode_warnings) && ev.decode_warnings.length > 0) return true;
    const status = ev.decode_status;
    return status !== undefined && status !== null && status !== "verified";
  });
}

/**
 * True when every configured RPC provider is currently unhealthy.
 * A single healthy provider means data can still be sourced, so no warning.
 *
 * @returns {boolean}
 */
export function providersUnavailable() {
  try {
    const stats = getProviderStats();
    return Array.isArray(stats) && stats.length > 0 && stats.every((p) => !p.healthy);
  } catch {
    // Provider health is best-effort telemetry — never fail a request over it.
    return false;
  }
}

/**
 * Collect live partial-data warnings for a response.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.metadataIncomplete] whether the served page had
 *   events that could not be decoded against verified metadata.
 * @returns {{ code: string, message: string }[]}
 */
export function collectPartialDataWarnings({ metadataIncomplete = false } = {}) {
  let lagSeconds = 0;
  try {
    lagSeconds = getIndexerStatus().lagSeconds ?? 0;
  } catch {
    lagSeconds = 0;
  }

  return buildPartialDataWarnings({
    lagSeconds,
    metadataIncomplete,
    providerUnavailable: providersUnavailable(),
  });
}
