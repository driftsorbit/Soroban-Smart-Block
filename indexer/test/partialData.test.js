// Unit tests for structured partial-data warnings (#1079).
// Pure logic plus the live-signal collector (health/RPC provider health are
// in-process modules with no network dependency).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PARTIAL_DATA_WARNING_CODES,
  PARTIAL_DATA_WARNING_MESSAGES,
  buildPartialDataWarnings,
  hasIncompleteMetadata,
  collectPartialDataWarnings,
} from "../src/partialData.js";
import { getIndexerStatus, updateIndexerStatus } from "../src/health.js";

describe("buildPartialDataWarnings (#1079)", () => {
  it("returns an empty array when nothing is degraded", () => {
    assert.deepEqual(buildPartialDataWarnings({}), []);
  });

  it("emits a stable code and message for indexer lag", () => {
    const warnings = buildPartialDataWarnings({ lagSeconds: 61, lagThresholdSeconds: 60 });
    assert.deepEqual(warnings, [
      { code: "indexer_lag", message: PARTIAL_DATA_WARNING_MESSAGES[PARTIAL_DATA_WARNING_CODES.INDEXER_LAG] },
    ]);
  });

  it("does not warn at exactly the lag threshold", () => {
    assert.deepEqual(buildPartialDataWarnings({ lagSeconds: 60, lagThresholdSeconds: 60 }), []);
  });

  it("emits metadata_unavailable when metadata was incomplete", () => {
    const warnings = buildPartialDataWarnings({ metadataIncomplete: true });
    assert.deepEqual(
      warnings.map((w) => w.code),
      ["metadata_unavailable"],
    );
  });

  it("emits provider_unavailable when no provider is healthy", () => {
    const warnings = buildPartialDataWarnings({ providerUnavailable: true });
    assert.deepEqual(
      warnings.map((w) => w.code),
      ["provider_unavailable"],
    );
  });

  it("returns every applicable warning in a stable order", () => {
    const warnings = buildPartialDataWarnings({
      lagSeconds: 999,
      lagThresholdSeconds: 30,
      metadataIncomplete: true,
      providerUnavailable: true,
    });
    assert.deepEqual(
      warnings.map((w) => w.code),
      ["indexer_lag", "metadata_unavailable", "provider_unavailable"],
    );
  });

  it("treats non-numeric lag as no lag", () => {
    assert.deepEqual(buildPartialDataWarnings({ lagSeconds: "not-a-number", lagThresholdSeconds: 30 }), []);
  });

  it("exposes a frozen, stable code set", () => {
    assert.deepEqual(Object.values(PARTIAL_DATA_WARNING_CODES).sort(), [
      "indexer_lag",
      "metadata_unavailable",
      "provider_unavailable",
    ]);
    assert.ok(Object.isFrozen(PARTIAL_DATA_WARNING_CODES));
  });
});

describe("hasIncompleteMetadata (#1079)", () => {
  it("is false for an empty page", () => {
    assert.equal(hasIncompleteMetadata([]), false);
    assert.equal(hasIncompleteMetadata(undefined), false);
  });

  it("is false when every event decoded against a verified ABI", () => {
    assert.equal(
      hasIncompleteMetadata([
        { seq: 1, decode_status: "verified", decode_warnings: [] },
        { seq: 2, decode_status: "verified" },
      ]),
      false,
    );
  });

  it("is true when any event is unverified, heuristic, or carried warnings", () => {
    assert.equal(hasIncompleteMetadata([{ decode_status: "verified" }, { decode_status: "unverified" }]), true);
    assert.equal(hasIncompleteMetadata([{ decode_status: "heuristic" }]), true);
    assert.equal(hasIncompleteMetadata([{ decode_warnings: ["abi_shape_mismatch"] }]), true);
  });

  it("ignores events with no decode_status field", () => {
    assert.equal(hasIncompleteMetadata([{ seq: 1 }, { seq: 2 }]), false);
  });
});

describe("collectPartialDataWarnings (#1079)", () => {
  it("returns an empty list when the indexer is caught up and metadata is complete", () => {
    updateIndexerStatus(1000, 0, 0);
    assert.deepEqual(collectPartialDataWarnings({ metadataIncomplete: false }), []);
  });

  it("surfaces lag reported through the health module", () => {
    updateIndexerStatus(1000, 600, 12);
    const codes = collectPartialDataWarnings().map((w) => w.code);
    assert.ok(codes.includes("indexer_lag"));
    // reset so other tests are not affected by shared module state
    updateIndexerStatus(1000, 0, 0);
  });

  it("surfaces metadata_incomplete passed by the caller", () => {
    updateIndexerStatus(1000, 0, 0);
    const codes = collectPartialDataWarnings({ metadataIncomplete: true }).map((w) => w.code);
    assert.deepEqual(codes, ["metadata_unavailable"]);
  });

  it("exposes indexer status via getIndexerStatus()", () => {
    updateIndexerStatus(4242, 7, 3);
    const status = getIndexerStatus();
    assert.equal(status.lastLedger, 4242);
    assert.equal(status.lagSeconds, 7);
    assert.equal(status.ledgerLag, 3);
    // snapshot is a copy — mutating it must not affect internal state
    status.lagSeconds = 999999;
    assert.equal(getIndexerStatus().lagSeconds, 7);
    updateIndexerStatus(1000, 0, 0);
  });
});
