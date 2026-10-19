// Verified ABI import manifests (issue #1055).
//
// A manifest is a small, versioned record that binds an ABI's metadata to a
// contract identity, a network, and a provenance statement. The metadata is
// represented only by a SHA-256 hash of its canonical JSON, so the manifest
// can be published or stored without the full ABI and still be checked later.

import { createHash } from "node:crypto";
import { lintAbi } from "./abiLint.js";

export const MANIFEST_VERSION = 1;
export const SUPPORTED_NETWORKS = Object.freeze(["mainnet", "testnet", "futurenet"]);

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const MAX_SOURCE_LENGTH = 64;
const MAX_REFERENCE_LENGTH = 500;

// Serialise with object keys sorted at every depth so that two equal
// metadata objects always produce the same bytes.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Hash the metadata an ABI manifest attests to: name, description and functions.
 *
 * @param {{ name?: string, description?: string|null, functions: unknown[] }} metadata
 * @returns {string} lowercase hex SHA-256
 */
export function hashMetadata(metadata) {
  const content = {
    name: metadata.name ?? null,
    description: metadata.description ?? null,
    functions: metadata.functions,
  };
  return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}

function validateIdentity({ contractId, network, provenance }) {
  const errors = [];
  if (typeof contractId !== "string" || !CONTRACT_ID_RE.test(contractId)) {
    errors.push({ path: "/contract_id", code: "invalid_contract_id", message: "contract_id must be a C... strkey" });
  }
  if (!SUPPORTED_NETWORKS.includes(network)) {
    errors.push({ path: "/network", code: "unsupported_network", message: `network must be one of ${SUPPORTED_NETWORKS.join(", ")}` });
  }
  if (!provenance || typeof provenance !== "object") {
    errors.push({ path: "/provenance", code: "invalid_provenance", message: "provenance must be an object" });
  } else {
    if (typeof provenance.source !== "string" || provenance.source.trim() === "" || provenance.source.length > MAX_SOURCE_LENGTH) {
      errors.push({ path: "/provenance/source", code: "invalid_provenance_source", message: `provenance.source must be 1–${MAX_SOURCE_LENGTH} characters` });
    }
    if (provenance.reference !== undefined && (typeof provenance.reference !== "string" || provenance.reference.length > MAX_REFERENCE_LENGTH)) {
      errors.push({ path: "/provenance/reference", code: "invalid_provenance_reference", message: `provenance.reference must be a string of at most ${MAX_REFERENCE_LENGTH} characters` });
    }
  }
  return errors;
}

/**
 * Build a manifest for a lint-clean ABI.
 *
 * @returns {{ ok: true, manifest: object } | { ok: false, errors: object[] }}
 */
export function buildManifest({ contractId, network, provenance, metadata }) {
  const errors = validateIdentity({ contractId, network, provenance });
  const lint = lintAbi(metadata?.functions);
  errors.push(...lint.errors);
  if (errors.length > 0) return { ok: false, errors };

  const manifest = {
    manifest_version: MANIFEST_VERSION,
    contract_id: contractId,
    network,
    provenance: {
      source: provenance.source,
      ...(provenance.reference !== undefined ? { reference: provenance.reference } : {}),
    },
    content_hash: hashMetadata(metadata),
  };
  return { ok: true, manifest };
}

/**
 * Check a manifest against the metadata it claims to describe.
 *
 * @returns {{ valid: boolean, errors: object[] }}
 */
export function verifyManifest(manifest, metadata) {
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: [{ path: "/", code: "invalid_manifest", message: "manifest must be an object" }] };
  }

  const errors = [];
  if (manifest.manifest_version !== MANIFEST_VERSION) {
    errors.push({ path: "/manifest_version", code: "unsupported_manifest_version", message: `manifest_version must be ${MANIFEST_VERSION}` });
  }
  errors.push(...validateIdentity({
    contractId: manifest.contract_id,
    network: manifest.network,
    provenance: manifest.provenance,
  }));
  if (typeof manifest.content_hash !== "string" || !/^[0-9a-f]{64}$/.test(manifest.content_hash)) {
    errors.push({ path: "/content_hash", code: "invalid_content_hash", message: "content_hash must be a 64-character lowercase hex SHA-256" });
  } else if (manifest.content_hash !== hashMetadata(metadata)) {
    errors.push({ path: "/content_hash", code: "content_hash_mismatch", message: "metadata does not match the manifest content_hash" });
  }
  return { valid: errors.length === 0, errors };
}
