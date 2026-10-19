import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CORRECTABLE_FIELDS, validateCorrection } from "../src/metadataCorrections.js";

// Issue #1059 — validation of public metadata correction requests.

const valid = { field: "name", new_value: "Soroban Token", reason: "  Typo in registered name  " };

describe("validateCorrection (#1059)", () => {
  it("accepts a well-formed correction and trims the reason", () => {
    assert.deepEqual(validateCorrection(valid), {
      field: "name",
      new_value: "Soroban Token",
      reason: "Typo in registered name",
    });
  });

  it("accepts the description field", () => {
    assert.equal(validateCorrection({ ...valid, field: "description" }).field, "description");
  });

  it("rejects a non-object body", () => {
    assert.ok(validateCorrection(null).error);
    assert.ok(validateCorrection("name").error);
  });

  it("rejects fields outside the correctable allowlist", () => {
    for (const field of ["functions", "registered_by", "__proto__", "constructor", undefined]) {
      assert.ok(validateCorrection({ ...valid, field }).error, `field=${String(field)}`);
    }
  });

  it("rejects empty, non-string and over-length new values", () => {
    assert.ok(validateCorrection({ ...valid, new_value: "   " }).error);
    assert.ok(validateCorrection({ ...valid, new_value: 42 }).error);
    assert.ok(validateCorrection({ ...valid, new_value: "x".repeat(CORRECTABLE_FIELDS.name.max + 1) }).error);
  });

  it("enforces the larger limit for description", () => {
    const longDescription = { field: "description", new_value: "x".repeat(2000), reason: "fix" };
    assert.equal(validateCorrection(longDescription).error, undefined);
    assert.ok(validateCorrection({ ...longDescription, new_value: "x".repeat(2001) }).error);
  });

  it("rejects a missing or blank reason", () => {
    assert.ok(validateCorrection({ ...valid, reason: undefined }).error);
    assert.ok(validateCorrection({ ...valid, reason: "  " }).error);
    assert.ok(validateCorrection({ ...valid, reason: "r".repeat(501) }).error);
  });

  it("ignores any actor supplied in the body", () => {
    const result = validateCorrection({ ...valid, actor: "someone-else" });
    assert.equal(result.actor, undefined);
  });
});
