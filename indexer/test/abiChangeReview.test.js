// Tests for field-level ABI change review (issue #1050).
// Target module: indexer/src/abiChangeReview.js (not yet implemented).
import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewAbiChange } from "../src/abiChangeReview.js";

const fn = (name, params = []) => ({ name, description: "", params });

const v1 = { functions: [fn("transfer", [{ name: "from", kind: "Address" }, { name: "amount", kind: "i128" }])] };

test("reports an added function and requires review", () => {
  const v2 = { functions: [...v1.functions, fn("mint", [{ name: "to", kind: "Address" }])] };
  const r = reviewAbiChange(v1, v2);
  assert.deepEqual(r.added.map((f) => f.name), ["mint"]);
  assert.equal(r.requiresReview, true);
});

test("reports a removed function", () => {
  const r = reviewAbiChange(v1, { functions: [] });
  assert.deepEqual(r.removed.map((f) => f.name), ["transfer"]);
  assert.equal(r.requiresReview, true);
});

test("reports a parameter type change at field level", () => {
  const v2 = { functions: [fn("transfer", [{ name: "from", kind: "Address" }, { name: "amount", kind: "u64" }])] };
  const r = reviewAbiChange(v1, v2);
  assert.deepEqual(r.changed, [
    {
      name: "transfer",
      params: { added: [], removed: [], typeChanged: [{ name: "amount", from: "i128", to: "u64" }] },
    },
  ]);
  assert.equal(r.requiresReview, true);
});

test("reports added and removed parameters", () => {
  const v2 = { functions: [fn("transfer", [{ name: "from", kind: "Address" }, { name: "memo", kind: "String" }])] };
  const r = reviewAbiChange(v1, v2);
  assert.deepEqual(r.changed[0].params.added, [{ name: "memo", kind: "String" }]);
  assert.deepEqual(r.changed[0].params.removed, [{ name: "amount", kind: "i128" }]);
});

test("identical versions produce no changes and no review requirement", () => {
  const r = reviewAbiChange(v1, structuredClone(v1));
  assert.deepEqual({ ...r, requiresReview: false }, { added: [], removed: [], changed: [], requiresReview: false });
});

test("description-only edits do not require review", () => {
  const v2 = { functions: [{ ...v1.functions[0], description: "Moves tokens." }] };
  assert.equal(reviewAbiChange(v1, v2).requiresReview, false);
});

test("empty old version treats every function as added", () => {
  const r = reviewAbiChange({ functions: [] }, v1);
  assert.deepEqual(r.added.map((f) => f.name), ["transfer"]);
});

test("throws TypeError on malformed input", () => {
  assert.throws(() => reviewAbiChange(null, v1), TypeError);
  assert.throws(() => reviewAbiChange(v1, { functions: "nope" }), TypeError);
});
