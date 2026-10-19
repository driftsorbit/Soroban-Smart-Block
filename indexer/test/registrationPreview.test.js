import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { previewRegistration, MAX_PREVIEW_SAMPLES } from "../src/registrationPreview.js";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const addressXdr = nativeToScVal(ADDRESS, { type: "address" }).toXDR("base64");
const i128Xdr = (n) => nativeToScVal(n, { type: "i128" }).toXDR("base64");

const functions = [
  {
    name: "transfer",
    description: "Moves tokens.",
    params: [
      { name: "to", kind: "Address" },
      { name: "amount", kind: "i128" },
    ],
  },
];

describe("previewRegistration (#1057)", () => {
  it("decodes correctly typed samples and renders values as JSON-safe strings", () => {
    const result = previewRegistration({
      functions,
      samples: [{ fn: "transfer", args: [addressXdr, i128Xdr(5n)] }],
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    const [sample] = result.samples;
    assert.equal(sample.fn, "transfer");
    assert.equal(sample.valid, true);
    assert.deepEqual(sample.args.map((a) => a.scval_type), ["scvAddress", "scvI128"]);
    assert.equal(sample.args[1].value, "5");
  });

  it("reports a sample whose ScVal type does not match the declared kind", () => {
    const result = previewRegistration({
      functions,
      samples: [{ fn: "transfer", args: [i128Xdr(1n), i128Xdr(5n)] }],
    });
    assert.equal(result.valid, false);
    assert.equal(result.samples[0].valid, false);
    assert.equal(result.errors[0].code, "arg_decode_failed");
    assert.equal(result.errors[0].path, "/samples/0/args/0");
    assert.match(result.errors[0].message, /expected scvAddress for kind "Address"/);
  });

  it("reports arguments that are not base64 ScVal", () => {
    const result = previewRegistration({
      functions,
      samples: [{ fn: "transfer", args: [addressXdr, "not-xdr!!"] }],
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "arg_decode_failed");
    assert.match(result.errors[0].message, /not a base64-encoded ScVal/);
  });

  it("reports samples for functions not in the proposed ABI", () => {
    const result = previewRegistration({ functions, samples: [{ fn: "burn", args: [] }] });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors.map((e) => e.code), ["unknown_function"]);
  });

  it("reports an argument count that does not match the parameter list", () => {
    const result = previewRegistration({ functions, samples: [{ fn: "transfer", args: [addressXdr] }] });
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "arg_count_mismatch");
  });

  it("does not type-check arguments for user-defined kinds", () => {
    const custom = [{ name: "f", params: [{ name: "x", kind: "MyStruct" }] }];
    const result = previewRegistration({ functions: custom, samples: [{ fn: "f", args: [i128Xdr(9n)] }] });
    assert.equal(result.valid, true);
    assert.equal(result.samples[0].args[0].scval_type, "scvI128");
  });

  it("returns lint errors and no sample results when the proposed ABI is invalid", () => {
    const result = previewRegistration({
      functions: [{ name: "dup" }, { name: "dup" }],
      samples: [{ fn: "dup", args: [] }],
    });
    assert.equal(result.valid, false);
    assert.equal(result.lint.errors[0].code, "duplicate_function");
    assert.deepEqual(result.samples, []);
  });

  it("accepts an empty sample list as a valid preview of the ABI itself", () => {
    const result = previewRegistration({ functions, samples: [] });
    assert.equal(result.valid, true);
    assert.deepEqual(result.samples, []);
  });

  it("rejects a non-array samples value and an oversized sample list", () => {
    assert.equal(previewRegistration({ functions, samples: "nope" }).errors[0].code, "invalid_samples");

    const tooMany = Array.from({ length: MAX_PREVIEW_SAMPLES + 1 }, () => ({ fn: "transfer", args: [] }));
    assert.equal(previewRegistration({ functions, samples: tooMany }).errors[0].code, "too_many_samples");
  });
});
