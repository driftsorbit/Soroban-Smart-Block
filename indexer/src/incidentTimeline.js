import { logger } from "./logger.js";
import { db } from "./db.js";

/**
 * Valid event categories for operator incident timeline
 */
export const VALID_EVENT_TYPES = Object.freeze([
  "deployment",
  "provider_change",
  "lag_spike",
  "recovery_action",
  "alert_trigger",
  "alert_resolve",
]);

export const VALID_SEVERITIES = Object.freeze(["info", "warning", "critical"]);

export const VALID_SOURCES = Object.freeze(["indexer", "rpc", "admin", "system", "alerting"]);

// In-memory fallback ring buffer for recent incidents
const MEMORY_BUFFER_CAP = 100;
let _memoryBuffer = [];
let _idCounter = 1;

export function clearIncidentsForTest() {
  _memoryBuffer = [];
  _idCounter = 1;
}

/**
 * Validate incident event input
 */
export function validateIncidentInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Incident payload must be a non-empty object" };
  }

  const { event_type, severity = "info", summary, source = "indexer", details = {} } = input;

  if (!event_type || typeof event_type !== "string" || !event_type.trim()) {
    return { valid: false, error: "Field 'event_type' is required and must be a non-empty string" };
  }

  const normalizedType = event_type.trim();
  if (!VALID_EVENT_TYPES.includes(normalizedType)) {
    return {
      valid: false,
      error: `Invalid 'event_type': '${normalizedType}'. Supported types: ${VALID_EVENT_TYPES.join(", ")}`,
    };
  }

  if (severity && !VALID_SEVERITIES.includes(severity)) {
    return {
      valid: false,
      error: `Invalid 'severity': '${severity}'. Supported: ${VALID_SEVERITIES.join(", ")}`,
    };
  }

  if (!summary || typeof summary !== "string" || !summary.trim()) {
    return { valid: false, error: "Field 'summary' is required and must be a non-empty string" };
  }

  if (details !== null && typeof details !== "object") {
    return { valid: false, error: "Field 'details' must be an object if provided" };
  }

  return {
    valid: true,
    data: {
      event_type: normalizedType,
      severity: severity || "info",
      source: String(source || "indexer"),
      summary: summary.trim(),
      details: typeof details === "object" && details !== null ? details : {},
    },
  };
}

/**
 * Record an incident in the operator timeline
 */
export async function recordIncident(event) {
  const validation = validateIncidentInput(event);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { statusCode: 400 });
  }

  const entry = {
    id: _idCounter++,
    ...validation.data,
    created_at: new Date().toISOString(),
  };

  // Keep in memory buffer
  _memoryBuffer.unshift(entry);
  if (_memoryBuffer.length > MEMORY_BUFFER_CAP) {
    _memoryBuffer.pop();
  }

  // Try DB persistence
  try {
    if (typeof db?.recordIncidentEvent === "function") {
      const persisted = await db.recordIncidentEvent(validation.data);
      if (persisted) {
        return persisted;
      }
    }
  } catch (err) {
    logger.warn(`[incidentTimeline] Failed to persist incident to DB, buffered in memory: ${err.message}`);
  }

  return entry;
}

/**
 * Query the incident timeline with filtering and pagination
 */
export async function getIncidentTimeline(filter = {}) {
  const { event_type, severity, source, from, to, limit = 50, offset = 0 } = filter;

  if (severity && !VALID_SEVERITIES.includes(severity)) {
    throw Object.assign(
      new Error(`Invalid 'severity': '${severity}'. Supported: ${VALID_SEVERITIES.join(", ")}`),
      { statusCode: 400 },
    );
  }

  if (event_type && !VALID_EVENT_TYPES.includes(event_type)) {
    throw Object.assign(
      new Error(`Invalid 'event_type': '${event_type}'. Supported: ${VALID_EVENT_TYPES.join(", ")}`),
      { statusCode: 400 },
    );
  }

  if (from && isNaN(new Date(from).getTime())) {
    throw Object.assign(new Error("Invalid date format for 'from'"), { statusCode: 400 });
  }

  if (to && isNaN(new Date(to).getTime())) {
    throw Object.assign(new Error("Invalid date format for 'to'"), { statusCode: 400 });
  }

  const numLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const numOffset = Math.max(Number(offset) || 0, 0);

  // Try DB query first
  try {
    if (typeof db?.getIncidentTimeline === "function") {
      return await db.getIncidentTimeline({
        event_type,
        severity,
        source,
        from,
        to,
        limit: numLimit,
        offset: numOffset,
      });
    }
  } catch (err) {
    logger.warn(`[incidentTimeline] DB query failed, falling back to memory buffer: ${err.message}`);
  }

  // Memory buffer fallback
  let filtered = [..._memoryBuffer];
  if (event_type) filtered = filtered.filter((e) => e.event_type === event_type);
  if (severity) filtered = filtered.filter((e) => e.severity === severity);
  if (source) filtered = filtered.filter((e) => e.source === source);
  if (from) {
    const fromTime = new Date(from).getTime();
    filtered = filtered.filter((e) => new Date(e.created_at).getTime() >= fromTime);
  }
  if (to) {
    const toTime = new Date(to).getTime();
    filtered = filtered.filter((e) => new Date(e.created_at).getTime() <= toTime);
  }

  const total = filtered.length;
  const data = filtered.slice(numOffset, numOffset + numLimit);

  return {
    data,
    total,
    limit: numLimit,
    offset: numOffset,
  };
}
