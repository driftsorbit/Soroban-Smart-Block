/**
 * Unit tests for classic asset identity resolution. Closes #1066
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAssetIdentity } from "../src/assetIdentity.js";

const A = "GA22K667OGPC3R32NRJTNQG4KWT2OFGHNNGZ2JQMSIGLT7AFHVIOMJ43";
const B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("resolveAssetIdentity (#1066)", () => {
  it("returns empty for missing or non-array input", () => {
    assert.deepEqual(resolveAssetIdentity(undefined), { status: "empty", identities: [], skipped: 0 });
    assert.deepEqual(resolveAssetIdentity([]), { status: "empty", identities: [], skipped: 0 });
  });

  it("merges records only when code and issuer both match", () => {
    const { identities } = resolveAssetIdentity([
      { code: "USDC", issuer: A, source: "transfer" },
      { code: "USDC", issuer: A, source: "sac" },
    ]);
    assert.equal(identities.length, 1);
    assert.deepEqual(identities[0].evidence, ["transfer", "sac"]);
  });

  it("keeps same-code assets from different issuers separate", () => {
    const { identities } = resolveAssetIdentity([
      { code: "USDC", issuer: A },
      { code: "USDC", issuer: B },
    ]);
    assert.equal(identities.length, 2);
    assert.deepEqual(identities[0].same_code_other_issuers, [B]);
    assert.deepEqual(identities[1].same_code_other_issuers, [A]);
  });

  it("does not merge different codes under the same issuer", () => {
    const { identities } = resolveAssetIdentity([
      { code: "USDC", issuer: A },
      { code: "EURC", issuer: A },
    ]);
    assert.equal(identities.length, 2);
    assert.deepEqual(identities[0].same_code_other_issuers, []);
  });

  it("skips invalid candidates and counts them", () => {
    const { identities, skipped } = resolveAssetIdentity([
      { code: "", issuer: A },
      { code: "USDC" },
      null,
      { code: "USDC", issuer: A },
    ]);
    assert.equal(skipped, 3);
    assert.equal(identities.length, 1);
  });
});
