import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildManifest, verifyManifest, hashMetadata, MANIFEST_VERSION } from "../src/abiManifest.js";

const CONTRACT_ID = `C${"A".repeat(55)}`;
const provenance = { source: "manual", reference: "https://example.com/abi" };
const metadata = {
  name: "ExampleToken",
  description: "A token.",
  functions: [{ name: "balance", params: [{ name: "id", kind: "Address" }] }],
};

describe("hashMetadata (#1055)", () => {
  it("is independent of object key order at every depth", () => {
    const reordered = {
      functions: [{ params: [{ kind: "Address", name: "id" }], name: "balance" }],
      description: "A token.",
      name: "ExampleToken",
    };
    assert.equal(hashMetadata(metadata), hashMetadata(reordered));
  });

  it("changes when any attested field changes", () => {
    const renamed = { ...metadata, name: "Other" };
    assert.notEqual(hashMetadata(metadata), hashMetadata(renamed));
  });

  it("returns a 64-character lowercase hex digest", () => {
    assert.match(hashMetadata(metadata), /^[0-9a-f]{64}$/);
  });
});

describe("buildManifest (#1055)", () => {
  it("produces a versioned manifest with identity, provenance and content hash", () => {
    const result = buildManifest({ contractId: CONTRACT_ID, network: "testnet", provenance, metadata });
    assert.equal(result.ok, true);
    assert.deepEqual(result.manifest, {
      manifest_version: MANIFEST_VERSION,
      contract_id: CONTRACT_ID,
      network: "testnet",
      provenance,
      content_hash: hashMetadata(metadata),
    });
  });

  it("omits provenance.reference when it was not supplied", () => {
    const result = buildManifest({
      contractId: CONTRACT_ID,
      network: "mainnet",
      provenance: { source: "github" },
      metadata,
    });
    assert.deepEqual(result.manifest.provenance, { source: "github" });
  });

  it("rejects a malformed contract id and an unsupported network", () => {
    const result = buildManifest({ contractId: "GNOTACONTRACT", network: "devnet", provenance, metadata });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e) => e.code), ["invalid_contract_id", "unsupported_network"]);
  });

  it("rejects missing or oversized provenance", () => {
    const missing = buildManifest({ contractId: CONTRACT_ID, network: "testnet", provenance: null, metadata });
    assert.deepEqual(missing.errors.map((e) => e.code), ["invalid_provenance"]);

    const blankSource = buildManifest({
      contractId: CONTRACT_ID,
      network: "testnet",
      provenance: { source: "   " },
      metadata,
    });
    assert.deepEqual(blankSource.errors.map((e) => e.code), ["invalid_provenance_source"]);
  });

  it("refuses to attest an ABI that fails lint", () => {
    const bad = { ...metadata, functions: [{ name: "dup" }, { name: "dup" }] };
    const result = buildManifest({ contractId: CONTRACT_ID, network: "testnet", provenance, metadata: bad });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "duplicate_function");
  });
});

describe("verifyManifest (#1055)", () => {
  const { manifest } = buildManifest({ contractId: CONTRACT_ID, network: "testnet", provenance, metadata });

  it("accepts a manifest that matches its metadata", () => {
    assert.deepEqual(verifyManifest(manifest, metadata), { valid: true, errors: [] });
  });

  it("detects metadata that has been altered after the manifest was built", () => {
    const tampered = { ...metadata, description: "Changed." };
    const result = verifyManifest(manifest, tampered);
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors.map((e) => e.code), ["content_hash_mismatch"]);
  });

  it("rejects an unknown manifest version", () => {
    const result = verifyManifest({ ...manifest, manifest_version: 2 }, metadata);
    assert.deepEqual(result.errors.map((e) => e.code), ["unsupported_manifest_version"]);
  });

  it("rejects a malformed content hash without comparing it", () => {
    const result = verifyManifest({ ...manifest, content_hash: "abc" }, metadata);
    assert.deepEqual(result.errors.map((e) => e.code), ["invalid_content_hash"]);
  });

  it("rejects a non-object manifest", () => {
    assert.deepEqual(verifyManifest(null, metadata).errors.map((e) => e.code), ["invalid_manifest"]);
  });
});
