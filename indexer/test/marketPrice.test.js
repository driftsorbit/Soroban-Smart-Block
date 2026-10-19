/**
 * Unit tests for market-data observation classification. Closes #1068
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPriceObservation, DEFAULT_MAX_AGE_MS } from "../src/marketPrice.js";

const NOW = Date.parse("2026-10-17T12:00:00Z");

describe("classifyPriceObservation (#1068)", () => {
  it("reports missing when there is no observation", () => {
    assert.deepEqual(classifyPriceObservation(null, { now: NOW }), {
      status: "missing",
      price: null,
      observed_at: null,
      age_ms: null,
    });
  });

  it("reports fresh for a recent positive price", () => {
    const result = classifyPriceObservation(
      { price: "1.0002", observed_at: new Date(NOW - 60_000) },
      { now: NOW },
    );
    assert.equal(result.status, "fresh");
    assert.equal(result.price, 1.0002);
    assert.equal(result.age_ms, 60_000);
  });

  it("reports stale once the observation is older than maxAgeMs", () => {
    const result = classifyPriceObservation(
      { price: 0.5, observed_at: new Date(NOW - DEFAULT_MAX_AGE_MS - 1) },
      { now: NOW },
    );
    assert.equal(result.status, "stale");
    assert.equal(result.price, 0.5);
  });

  it("never turns a zero, null, or non-numeric price into a value", () => {
    for (const price of [0, "0", null, "", "abc", -1, Number.NaN]) {
      const result = classifyPriceObservation({ price, observed_at: new Date(NOW) }, { now: NOW });
      assert.equal(result.status, "incomplete", `price ${String(price)}`);
      assert.equal(result.price, null);
    }
  });

  it("reports incomplete when the timestamp is missing or invalid", () => {
    assert.equal(classifyPriceObservation({ price: 1, observed_at: null }, { now: NOW }).status, "incomplete");
    assert.equal(classifyPriceObservation({ price: 1, observed_at: "not-a-date" }, { now: NOW }).status, "incomplete");
  });

  it("clamps a future timestamp to zero age instead of reporting negative age", () => {
    const result = classifyPriceObservation({ price: 2, observed_at: new Date(NOW + 5_000) }, { now: NOW });
    assert.equal(result.status, "fresh");
    assert.equal(result.age_ms, 0);
  });
});
