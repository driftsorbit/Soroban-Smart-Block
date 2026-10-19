// ABI registration preview with sample XDR (issue #1057).
//
// Before an ABI update is published, decode sample call arguments under the
// proposed metadata. Each argument is a base64 ScVal; it is checked against the
// declared parameter kind and rendered with the same decoder the event feed uses.
//
// Pure: no RPC or database access.

import { xdr } from "@stellar/stellar-sdk";
import { lintAbi } from "./abiLint.js";
import { scValToJs } from "./scval.js";

export const MAX_PREVIEW_SAMPLES = 20;

// Declared kind (lower-cased) → ScVal discriminant it must decode to.
// Kinds not listed here are user-defined; their values are decoded but not type-checked.
const KIND_TO_SCVAL = Object.freeze({
  address: ["scvAddress"],
  bool: ["scvBool"],
  bytes: ["scvBytes"],
  bytesn: ["scvBytes"],
  duration: ["scvDuration"],
  i32: ["scvI32"],
  i64: ["scvI64"],
  i128: ["scvI128"],
  i256: ["scvI256"],
  map: ["scvMap"],
  string: ["scvString"],
  symbol: ["scvSymbol"],
  timepoint: ["scvTimepoint"],
  tuple: ["scvVec"],
  u32: ["scvU32"],
  u64: ["scvU64"],
  u128: ["scvU128"],
  u256: ["scvU256"],
  vec: ["scvVec"],
  void: ["scvVoid"],
});

// bigint values are not JSON-serialisable; render them as decimal strings.
function toJsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

function decodeArg(b64, kind) {
  let val;
  try {
    val = xdr.ScVal.fromXDR(b64, "base64");
  } catch {
    return { ok: false, error: "not a base64-encoded ScVal" };
  }

  const scvType = val.switch().name;
  const expected = KIND_TO_SCVAL[String(kind).toLowerCase()];
  if (expected && !expected.includes(scvType)) {
    return { ok: false, scval_type: scvType, error: `expected ${expected.join(" or ")} for kind "${kind}"` };
  }

  try {
    return { ok: true, scval_type: scvType, value: toJsonSafe(scValToJs(val)) };
  } catch (e) {
    return { ok: false, scval_type: scvType, error: `decode failed: ${e.message}` };
  }
}

/**
 * Preview how sample calls decode under a proposed ABI.
 *
 * @param {{ functions: unknown[], samples?: Array<{ fn: string, args: string[] }> }} input
 * @returns {{ valid: boolean, lint: object, samples: object[], errors: object[] }}
 */
export function previewRegistration({ functions, samples = [] }) {
  const lint = lintAbi(functions);
  const errors = [];

  if (!Array.isArray(samples)) {
    errors.push({ path: "/samples", code: "invalid_samples", message: "samples must be an array" });
    return { valid: false, lint, samples: [], errors };
  }
  if (samples.length > MAX_PREVIEW_SAMPLES) {
    errors.push({ path: "/samples", code: "too_many_samples", message: `at most ${MAX_PREVIEW_SAMPLES} samples per preview` });
    return { valid: false, lint, samples: [], errors };
  }
  if (!lint.valid) return { valid: false, lint, samples: [], errors };

  const byName = new Map(functions.map((f) => [f.name, f]));
  const results = samples.map((sample, i) => {
    const path = `/samples/${i}`;
    const fn = byName.get(sample?.fn);
    if (!fn) {
      errors.push({ path: `${path}/fn`, code: "unknown_function", message: `no function "${sample?.fn}" in the proposed ABI` });
      return { fn: sample?.fn ?? null, valid: false, args: [] };
    }

    const params = fn.params ?? fn.args ?? [];
    const args = Array.isArray(sample.args) ? sample.args : [];
    if (args.length !== params.length) {
      errors.push({
        path: `${path}/args`,
        code: "arg_count_mismatch",
        message: `"${fn.name}" takes ${params.length} argument(s), sample provides ${args.length}`,
      });
      return { fn: fn.name, valid: false, args: [] };
    }

    const decoded = args.map((b64, j) => ({
      name: params[j].name,
      kind: params[j].kind,
      ...decodeArg(b64, params[j].kind),
    }));
    const valid = decoded.every((d) => d.ok);
    decoded.forEach((d, j) => {
      if (!d.ok) errors.push({ path: `${path}/args/${j}`, code: "arg_decode_failed", message: d.error });
    });
    return { fn: fn.name, valid, args: decoded };
  });

  return { valid: errors.length === 0, lint, samples: results, errors };
}
