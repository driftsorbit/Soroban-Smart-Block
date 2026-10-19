// Tests for validating submitted ABI metadata against deployed spec hashes (issue #1052).
// Target module: indexer/src/abiSpecValidation.js (not yet implemented).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashAbiFunctions, validateAbiAgainstSpec } from "../src/abiSpecValidation.js";

const functions = [
  { name: "balance", description: "", params: [{ name: "id", kind: "Address" }] },
];
const deployedSpec = { functions: structuredClone(functions) };

test("hash is deterministic and independent of key order", () => {
  const reordered = [{ params: [{ kind: "Address", name: "id" }], description: "", name: "balance" }];
  assert.equal(hashAbiFunctions(functions), hashAbiFunctions(reordered));
});

test("hash is a 64-character lowercase hex SHA-256 digest", () => {
  assert.match(hashAbiFunctions(functions), /^[0-9a-f]{64}$/);
});

test("hash changes when a parameter kind changes", () => {
  const changed = [{ ...functions[0], params: [{ name: "id", kind: "String" }] }];
  assert.notEqual(hashAbiFunctions(functions), hashAbiFunctions(changed));
});

test("reports verified when submitted functions match the deployed spec", () => {
  const r = validateAbiAgainstSpec(functions, deployedSpec);
  assert.equal(r.status, "verified");
  assert.equal(r.submittedHash, r.deployedHash);
});

test("reports mismatched when the deployed spec differs", () => {
  const other = { functions: [{ ...functions[0], params: [{ name: "id", kind: "u32" }] }] };
  const r = validateAbiAgainstSpec(functions, other);
  assert.equal(r.status, "mismatched");
  assert.notEqual(r.submittedHash, r.deployedHash);
});

test("reports unavailable when no deployed spec exists", () => {
  const r = validateAbiAgainstSpec(functions, null);
  assert.deepEqual(r, { status: "unavailable", submittedHash: hashAbiFunctions(functions), deployedHash: null });
});

test("empty submitted functions are hashed, not rejected", () => {
  assert.match(hashAbiFunctions([]), /^[0-9a-f]{64}$/);
  assert.equal(validateAbiAgainstSpec([], { functions: [] }).status, "verified");
});

test("throws TypeError on invalid submitted input", () => {
  assert.throws(() => validateAbiAgainstSpec(null, deployedSpec), TypeError);
  assert.throws(() => hashAbiFunctions("balance"), TypeError);
});
