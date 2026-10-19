import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lintAbi, LIMITS } from "../src/abiLint.js";

const codes = (list) => list.map((i) => i.code);

describe("lintAbi (#1054)", () => {
  it("accepts a well-formed function list with no findings", () => {
    const result = lintAbi([
      { name: "transfer", description: "Moves tokens.", params: [{ name: "to", kind: "Address" }, { name: "amount", kind: "i128" }] },
    ]);
    assert.deepEqual(result, { valid: true, errors: [], warnings: [] });
  });

  it("rejects a non-array functions value", () => {
    const result = lintAbi({ name: "transfer" });
    assert.equal(result.valid, false);
    assert.deepEqual(codes(result.errors), ["invalid_functions"]);
  });

  it("warns, but stays valid, on an empty function list", () => {
    const result = lintAbi([]);
    assert.equal(result.valid, true);
    assert.deepEqual(codes(result.warnings), ["no_functions"]);
  });

  it("flags function names that are not valid Soroban symbols", () => {
    assert.deepEqual(codes(lintAbi([{ name: "has space" }]).errors), ["invalid_function_name"]);
    assert.deepEqual(codes(lintAbi([{ name: "x".repeat(LIMITS.maxSymbolLength + 1) }]).errors), ["invalid_function_name"]);
    assert.deepEqual(codes(lintAbi([{ name: "" }]).errors), ["invalid_function_name"]);
  });

  it("accepts a function name at exactly the symbol length limit", () => {
    assert.equal(lintAbi([{ name: "x".repeat(LIMITS.maxSymbolLength) }]).valid, true);
  });

  it("reports duplicate function names with the offending index", () => {
    const result = lintAbi([{ name: "mint" }, { name: "burn" }, { name: "mint" }]);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "duplicate_function");
    assert.equal(result.errors[0].path, "/functions/2/name");
  });

  it("reports duplicate parameter names within one function only", () => {
    const dupInOne = lintAbi([{ name: "f", params: [{ name: "a", kind: "u32" }, { name: "a", kind: "u32" }] }]);
    assert.deepEqual(codes(dupInOne.errors), ["duplicate_param"]);

    const sameNameTwoFns = lintAbi([
      { name: "f", params: [{ name: "a", kind: "u32" }] },
      { name: "g", params: [{ name: "a", kind: "u32" }] },
    ]);
    assert.equal(sameNameTwoFns.valid, true);
  });

  it("requires a non-empty kind and warns on unknown kinds without failing", () => {
    const missing = lintAbi([{ name: "f", params: [{ name: "a", kind: "" }] }]);
    assert.deepEqual(codes(missing.errors), ["missing_param_kind"]);

    const custom = lintAbi([{ name: "f", params: [{ name: "a", kind: "MyStruct" }] }]);
    assert.equal(custom.valid, true);
    assert.deepEqual(codes(custom.warnings), ["unknown_param_kind"]);
  });

  it("enforces description and parameter-count limits at the boundary", () => {
    const atLimit = lintAbi([{ name: "f", description: "d".repeat(LIMITS.maxDescriptionLength) }]);
    assert.equal(atLimit.valid, true);

    const overDescription = lintAbi([{ name: "f", description: "d".repeat(LIMITS.maxDescriptionLength + 1) }]);
    assert.deepEqual(codes(overDescription.errors), ["description_too_long"]);

    const params = Array.from({ length: LIMITS.maxParamsPerFunction + 1 }, (_, i) => ({ name: `p${i}`, kind: "u32" }));
    assert.deepEqual(codes(lintAbi([{ name: "f", params }]).errors), ["too_many_params"]);
  });

  it("enforces the function-count limit", () => {
    const functions = Array.from({ length: LIMITS.maxFunctions + 1 }, (_, i) => ({ name: `f${i}` }));
    assert.deepEqual(codes(lintAbi(functions).errors), ["too_many_functions"]);
  });

  it("returns every finding, not just the first", () => {
    const result = lintAbi([{ name: "bad name" }, { name: "bad name" }]);
    assert.deepEqual(codes(result.errors), ["invalid_function_name", "invalid_function_name"]);
  });
});
