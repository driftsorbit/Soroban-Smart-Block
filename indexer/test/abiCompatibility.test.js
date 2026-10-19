// Tests for ABI compatibility report (issue #1051).
// Target module: indexer/src/abiCompatibility.js (not yet implemented).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompatibilityReport } from "../src/abiCompatibility.js";

const fn = (name, params = []) => ({ name, description: "", params });
const base = [fn("transfer", [{ name: "from", kind: "Address" }, { name: "amount", kind: "i128" }])];

test("compatible when nothing changed", () => {
  const r = buildCompatibilityReport(base, structuredClone(base));
  assert.equal(r.compatible, true);
  assert.deepEqual(r.issues, []);
});

test("flags a parameter name change", () => {
  const next = [fn("transfer", [{ name: "sender", kind: "Address" }, { name: "amount", kind: "i128" }])];
  const r = buildCompatibilityReport(base, next);
  assert.equal(r.compatible, false);
  assert.deepEqual(r.issues, [
    { function: "transfer", code: "PARAM_NAME_CHANGED", index: 0, from: "from", to: "sender" },
  ]);
});

test("flags a parameter kind change", () => {
  const next = [fn("transfer", [{ name: "from", kind: "Address" }, { name: "amount", kind: "u64" }])];
  const r = buildCompatibilityReport(base, next);
  assert.equal(r.issues[0].code, "PARAM_KIND_CHANGED");
  assert.equal(r.issues[0].from, "i128");
  assert.equal(r.issues[0].to, "u64");
});

test("flags a removed function", () => {
  const r = buildCompatibilityReport(base, []);
  assert.deepEqual(r.issues, [{ function: "transfer", code: "FUNCTION_REMOVED" }]);
});

test("added function is not an incompatibility", () => {
  const next = [...base, fn("mint", [{ name: "to", kind: "Address" }])];
  assert.equal(buildCompatibilityReport(base, next).compatible, true);
});

test("output is JSON-serialisable and stable in shape", () => {
  const next = [fn("transfer", [{ name: "sender", kind: "u64" }])];
  const r = buildCompatibilityReport(base, next);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.deepEqual(Object.keys(r).sort(), ["compatible", "issues"]);
});

test("empty input yields a compatible empty report", () => {
  assert.deepEqual(buildCompatibilityReport([], []), { compatible: true, issues: [] });
});

test("throws TypeError when either side is not an array", () => {
  assert.throws(() => buildCompatibilityReport(null, base), TypeError);
  assert.throws(() => buildCompatibilityReport(base, {}), TypeError);
});
