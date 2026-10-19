import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUpgradeLineage } from "../src/upgradeLineage.js";

const H = (c) => c.repeat(64);

const versions = [
  { abi_version: 0, min_ledger: 100, created_at: "2026-01-01T00:00:00Z" },
  { abi_version: 1, min_ledger: 500, created_at: "2026-02-01T00:00:00Z" },
  { abi_version: 2, min_ledger: 900, created_at: "2026-03-01T00:00:00Z" },
];

describe("buildUpgradeLineage (#1056)", () => {
  it("returns no WASM versions and no upgrades when the contract was never upgraded", () => {
    const result = buildUpgradeLineage(versions, []);
    assert.deepEqual(result.wasm_versions, []);
    assert.equal(result.upgrade_count, 0);
    assert.deepEqual(result.metadata_versions.map((v) => v.abi_version), [0, 1, 2]);
  });

  it("returns empty lists for a contract with no rows at all", () => {
    assert.deepEqual(buildUpgradeLineage(), {
      wasm_versions: [],
      metadata_versions: [],
      upgrade_count: 0,
    });
  });

  it("records the pre-upgrade WASM as the first version and marks the newest as current", () => {
    const upgrades = [
      { ledger: 600, tx_hash: "tx2", upgrade_info: { oldHash: H("a"), newHash: H("b") } },
    ];
    const { wasm_versions } = buildUpgradeLineage(versions, upgrades);
    assert.equal(wasm_versions.length, 2);
    assert.deepEqual(wasm_versions[0], {
      wasm_hash: H("a"),
      activated_ledger: null,
      activated_tx_hash: null,
      superseded_ledger: 600,
      is_current: false,
      metadata_abi_version: null,
    });
    assert.deepEqual(wasm_versions[1], {
      wasm_hash: H("b"),
      activated_ledger: 600,
      activated_tx_hash: "tx2",
      superseded_ledger: null,
      is_current: true,
      metadata_abi_version: 1,
    });
  });

  it("orders upgrades by ledger regardless of input order and chains supersession", () => {
    const upgrades = [
      { ledger: "950", tx_hash: "tx3", upgrade_info: { oldHash: H("b"), newHash: H("c") } },
      { ledger: 600, tx_hash: "tx2", upgrade_info: { oldHash: H("a"), newHash: H("b") } },
    ];
    const { wasm_versions, upgrade_count } = buildUpgradeLineage(versions, upgrades);
    assert.equal(upgrade_count, 2);
    assert.deepEqual(wasm_versions.map((w) => w.wasm_hash), [H("a"), H("b"), H("c")]);
    assert.deepEqual(wasm_versions.map((w) => w.superseded_ledger), [600, 950, null]);
    assert.deepEqual(wasm_versions.map((w) => w.metadata_abi_version), [null, 1, 2]);
    assert.equal(wasm_versions[2].is_current, true);
    assert.equal(wasm_versions[1].is_current, false);
  });

  it("maps each upgrade to the metadata version that was in force at its ledger", () => {
    const upgrades = [
      { ledger: 499, tx_hash: "t1", upgrade_info: { oldHash: H("a"), newHash: H("b") } },
      { ledger: 500, tx_hash: "t2", upgrade_info: { oldHash: H("b"), newHash: H("c") } },
    ];
    const { wasm_versions } = buildUpgradeLineage(versions, upgrades);
    assert.equal(wasm_versions[1].metadata_abi_version, 0);
    assert.equal(wasm_versions[2].metadata_abi_version, 1);
  });

  it("ignores upgrade rows without a new hash or ledger", () => {
    const upgrades = [
      { ledger: 700, tx_hash: "t", upgrade_info: { oldHash: H("a") } },
      { ledger: null, tx_hash: "t", upgrade_info: { oldHash: H("a"), newHash: H("b") } },
      { ledger: 800, tx_hash: "t", upgrade_info: null },
    ];
    const result = buildUpgradeLineage(versions, upgrades);
    assert.equal(result.upgrade_count, 0);
    assert.deepEqual(result.wasm_versions, []);
  });

  it("omits the initial WASM when the first upgrade carries no old hash", () => {
    const upgrades = [{ ledger: 600, tx_hash: "t", upgrade_info: { oldHash: null, newHash: H("b") } }];
    const { wasm_versions } = buildUpgradeLineage(versions, upgrades);
    assert.deepEqual(wasm_versions.map((w) => w.wasm_hash), [H("b")]);
    assert.equal(wasm_versions[0].is_current, true);
  });

  it("normalises string-typed version columns to numbers", () => {
    const stringRows = [{ abi_version: "3", min_ledger: "1000", created_at: null }];
    const { metadata_versions } = buildUpgradeLineage(stringRows, []);
    assert.deepEqual(metadata_versions, [{ abi_version: 3, min_ledger: 1000, created_at: null }]);
  });
});
