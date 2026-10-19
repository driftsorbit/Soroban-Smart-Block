/**
 * Event-list field selection (#1078).
 *
 * `GET /api/events` and `GET /api/v1/events` accept an optional `?fields=`
 * query parameter that restricts each returned event to a documented subset
 * of fields. This keeps payloads small for clients that only need e.g. a
 * feed of `seq,ledger,function,description`.
 *
 * The selectable set is an explicit allowlist — clients can never ask for
 * arbitrary columns — and the number of requested fields is bounded, so a
 * single request's response size stays predictable.
 *
 * Selection is purely presentational: it runs on the rows the database
 * already returned, so it does not change which events match or their order.
 * Omitting `fields` returns the full event object, preserving existing
 * behavior.
 */

import config from "./config.js";

/**
 * Fields a client may select. These are the stable, documented columns of an
 * event response (see `DecodedEvent` in docs/api/openapi.yaml). Internal-only
 * bookkeeping columns (e.g. `needs_redecode`, `lineage_batch_id`) are
 * deliberately excluded.
 */
export const EVENT_SELECTABLE_FIELDS = Object.freeze([
  "seq",
  "contract_id",
  "function",
  "ledger",
  "tx_hash",
  "description",
  "type",
  "created_at",
  "caller_address",
  "abi_version",
  "decode_status",
  "decode_warnings",
  "decode_source",
  "decoded",
  "is_high_bloat_risk",
  "is_clawback",
  "is_resource_limit_exceeded",
  "fee_charged",
  "cpu_instructions",
  "mem_bytes",
  "protocol_version",
  "protocol_degraded",
  "raw_topics",
  "raw_data",
  "slippage_bps",
  "sac_asset",
  "topic_count",
]);

const SELECTABLE_SET = new Set(EVENT_SELECTABLE_FIELDS);

/**
 * Parse and validate a `?fields=` value.
 *
 * @param {string} raw comma-separated field names
 * @param {object} [opts]
 * @param {number} [opts.max] maximum number of fields allowed
 * @returns {{ ok: true, fields: string[] } | { ok: false, error: string, message: string, allowed?: string[] }}
 */
export function parseFieldSelection(raw, { max = config.EVENT_FIELDS_MAX } = {}) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      error: "invalid_fields",
      message: "fields must be a non-empty comma-separated list of field names",
      allowed: [...EVENT_SELECTABLE_FIELDS],
    };
  }

  const requested = raw
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    return {
      ok: false,
      error: "invalid_fields",
      message: "fields must contain at least one field name",
      allowed: [...EVENT_SELECTABLE_FIELDS],
    };
  }

  // Deduplicate while preserving the requested order.
  const fields = [...new Set(requested)];

  const unknown = fields.filter((f) => !SELECTABLE_SET.has(f));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: "invalid_fields",
      message: `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
      allowed: [...EVENT_SELECTABLE_FIELDS],
    };
  }

  if (fields.length > max) {
    return {
      ok: false,
      error: "too_many_fields",
      message: `At most ${max} fields may be selected, got ${fields.length}`,
      allowed: [...EVENT_SELECTABLE_FIELDS],
    };
  }

  return { ok: true, fields };
}

/**
 * Project a single event onto the requested fields. Fields that are absent
 * from the source are omitted rather than emitted as `null`, so a partial
 * object only ever contains keys that exist.
 *
 * @param {object} event
 * @param {string[]} fields
 * @returns {object}
 */
export function projectEvent(event, fields) {
  const out = {};
  if (!event || typeof event !== "object") return out;
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(event, key)) {
      out[key] = event[key];
    }
  }
  return out;
}

/**
 * Project a resulset of events. A no-op when `fields` is empty/undefined.
 *
 * @param {Array<object>} events
 * @param {string[]} [fields]
 * @returns {Array<object>}
 */
export function projectEvents(events, fields) {
  if (!Array.isArray(events) || !fields || fields.length === 0) return events;
  return events.map((ev) => projectEvent(ev, fields));
}
