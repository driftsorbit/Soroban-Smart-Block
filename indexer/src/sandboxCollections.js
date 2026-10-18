import crypto from "crypto";
import { db } from "./db.js";

// In-memory fallback cache when PostgreSQL is not configured or in unit test mode
const inMemoryCollections = new Map();

/**
 * Regex detecting Stellar Ed25519 Secret Keys (S... followed by 55 base32 chars)
 */
const STELLAR_SECRET_KEY_REGEX = /\bS[A-Z2-7]{55}\b/g;

/**
 * Common sensitive property names to strip from scenarios
 */
const SENSITIVE_KEY_REGEX = /^(secret|private_?key|seed|password|bearer|auth_?token|access_?token|api_?key)/i;

/**
 * Deep sanitization to remove any private keys or secrets from scenario data.
 * @param {unknown} val
 * @returns {{ sanitized: any, strippedCount: number }}
 */
export function sanitizeSecrets(val) {
  let strippedCount = 0;

  function walk(current) {
    if (current === null || current === undefined) {
      return current;
    }

    if (typeof current === "string") {
      if (STELLAR_SECRET_KEY_REGEX.test(current)) {
        strippedCount++;
        return current.replace(STELLAR_SECRET_KEY_REGEX, "[REDACTED_SECRET_KEY]");
      }
      return current;
    }

    if (Array.isArray(current)) {
      return current.map((item) => walk(item));
    }

    if (typeof current === "object") {
      const result = {};
      for (const [key, value] of Object.entries(current)) {
        if (SENSITIVE_KEY_REGEX.test(key)) {
          strippedCount++;
          // Drop sensitive field entirely or redact
          continue;
        }
        result[key] = walk(value);
      }
      return result;
    }

    return current;
  }

  const sanitized = walk(val);
  return { sanitized, strippedCount };
}

/**
 * Validate a scenario object.
 * @param {any} s
 * @param {number} idx
 */
export function validateScenarioItem(s, idx = 0) {
  if (!s || typeof s !== "object") {
    throw new Error(`Scenario at index ${idx} must be a valid object`);
  }
  if (!s.contractId || typeof s.contractId !== "string" || !s.contractId.trim()) {
    throw new Error(`Scenario at index ${idx} requires a valid contractId`);
  }
  if (!s.fn || typeof s.fn !== "string" || !s.fn.trim()) {
    throw new Error(`Scenario at index ${idx} requires a valid fn (function name)`);
  }
  if (s.args !== undefined && !Array.isArray(s.args) && typeof s.args !== "string") {
    throw new Error(`Scenario at index ${idx} args must be an array or JSON string`);
  }

  const scenarioId = s.id && typeof s.id === "string" ? s.id : `scen-${crypto.randomBytes(6).toString("hex")}`;
  const scenarioName = s.name && typeof s.name === "string" ? s.name.trim().slice(0, 128) : `Scenario ${idx + 1}`;

  return {
    id: scenarioId,
    name: scenarioName,
    description: typeof s.description === "string" ? s.description.trim().slice(0, 500) : "",
    contractId: s.contractId.trim(),
    fn: s.fn.trim(),
    args: Array.isArray(s.args) ? s.args : typeof s.args === "string" ? s.args : [],
    auth: Array.isArray(s.auth) ? s.auth : [],
    env: s.env && typeof s.env === "object" ? s.env : {},
    baselineResult: s.baselineResult && typeof s.baselineResult === "object" ? s.baselineResult : null,
  };
}

/**
 * List scenario collections with pagination.
 */
export async function listCollections({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);

  try {
    const res = await db.query(
      `SELECT id, name, description, jsonb_array_length(scenarios) AS scenario_count, created_at, updated_at
       FROM sandbox_scenario_collections
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`,
      [safeLimit, safeOffset],
    );

    const countRes = await db.query("SELECT COUNT(*) AS total FROM sandbox_scenario_collections");
    const total = parseInt(countRes.rows[0]?.total ?? "0", 10);

    return {
      collections: res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description || "",
        scenarioCount: parseInt(r.scenario_count ?? "0", 10),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      limit: safeLimit,
      offset: safeOffset,
    };
  } catch (_dbErr) {
    // Fallback to in-memory store
    const all = Array.from(inMemoryCollections.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const sliced = all.slice(safeOffset, safeOffset + safeLimit);
    return {
      collections: sliced.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || "",
        scenarioCount: c.scenarios.length,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      total: all.length,
      limit: safeLimit,
      offset: safeOffset,
    };
  }
}

/**
 * Get a scenario collection by ID.
 */
export async function getCollection(id) {
  if (!id || typeof id !== "string") {
    throw new Error("Invalid collection ID");
  }

  try {
    const res = await db.query(
      "SELECT id, name, description, scenarios, created_at, updated_at FROM sandbox_scenario_collections WHERE id = $1",
      [id],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description || "",
      scenarios: typeof r.scenarios === "string" ? JSON.parse(r.scenarios) : r.scenarios || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  } catch (_dbErr) {
    return inMemoryCollections.get(id) || null;
  }
}

/**
 * Save (create or update) a scenario collection.
 */
export async function saveCollection(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Collection data must be a valid JSON object");
  }

  const { sanitized, strippedCount } = sanitizeSecrets(data);
  const name = typeof sanitized.name === "string" ? sanitized.name.trim() : "";
  if (!name) {
    throw new Error("Collection name is required and cannot be empty");
  }

  const description = typeof sanitized.description === "string" ? sanitized.description.trim().slice(0, 1000) : "";
  if (sanitized.scenarios !== undefined && sanitized.scenarios !== null && !Array.isArray(sanitized.scenarios)) {
    throw new Error("scenarios must be an array");
  }
  const rawScenarios = Array.isArray(sanitized.scenarios) ? sanitized.scenarios : [];
  const scenarios = rawScenarios.map((s, idx) => validateScenarioItem(s, idx));

  const id =
    sanitized.id && typeof sanitized.id === "string" && sanitized.id.trim()
      ? sanitized.id.trim()
      : `col_${crypto.randomBytes(8).toString("hex")}`;

  const now = new Date().toISOString();

  const collection = {
    id,
    name,
    description,
    scenarios,
    createdAt: sanitized.createdAt || now,
    updatedAt: now,
  };

  try {
    await db.query(
      `INSERT INTO sandbox_scenario_collections (id, name, description, scenarios, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         scenarios = EXCLUDED.scenarios,
         updated_at = EXCLUDED.updated_at`,
      [id, name, description, JSON.stringify(scenarios), collection.createdAt, collection.updatedAt],
    );
  } catch (_dbErr) {
    // In-memory fallback
    inMemoryCollections.set(id, collection);
  }

  return {
    collection,
    strippedSecretsCount: strippedCount,
  };
}

/**
 * Delete a scenario collection by ID.
 */
export async function deleteCollection(id) {
  if (!id || typeof id !== "string") {
    throw new Error("Invalid collection ID");
  }

  let deleted = false;
  try {
    const res = await db.query("DELETE FROM sandbox_scenario_collections WHERE id = $1 RETURNING id", [id]);
    deleted = res.rows.length > 0;
  } catch (_dbErr) {
    deleted = inMemoryCollections.delete(id);
  }

  return { deleted, id };
}

/**
 * Export a collection as sanitized JSON without private keys or secrets.
 */
export async function exportCollection(idOrData) {
  let collection;
  if (typeof idOrData === "string") {
    collection = await getCollection(idOrData);
    if (!collection) {
      throw new Error(`Scenario collection not found: ${idOrData}`);
    }
  } else if (idOrData && typeof idOrData === "object") {
    collection = idOrData;
  } else {
    throw new Error("Invalid input for export: expected collection ID or collection object");
  }

  // Deep sanitize to guarantee no private keys or secrets leak
  const { sanitized, strippedCount } = sanitizeSecrets(collection);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    schema: "soroban-sandbox-collection-v1",
    collection: sanitized,
    strippedSecretsCount: strippedCount,
  };
}

/**
 * Import a collection from JSON, validating contents and stripping any secrets.
 */
export async function importCollection(payload) {
  if (!payload) {
    throw new Error("Import payload cannot be empty");
  }

  let data = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error("Import payload must be valid JSON");
    }
  }

  if (typeof data !== "object" || data === null) {
    throw new Error("Import payload must be a JSON object");
  }

  // If wrapped in export envelope
  const collectionData = data.collection || data;

  if (!collectionData || typeof collectionData !== "object") {
    throw new Error("Collection data is missing from import payload");
  }

  // Ensure fresh unique ID on import unless preserving
  const importedId = `col_${crypto.randomBytes(8).toString("hex")}`;
  const prepared = {
    ...collectionData,
    id: importedId,
    name: collectionData.name ? `${collectionData.name} (Imported)` : "Imported Collection",
  };

  const result = await saveCollection(prepared);
  return {
    success: true,
    collection: result.collection,
    strippedSecretsCount: result.strippedSecretsCount,
  };
}
