// Unit tests for event-list field selection (#1078).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EVENT_SELECTABLE_FIELDS, parseFieldSelection, projectEvent, projectEvents } from "../src/fieldSelection.js";

describe("parseFieldSelection (#1078)", () => {
  it("accepts a comma-separated subset of allowed fields", () => {
    const result = parseFieldSelection("seq,ledger,function");
    assert.deepEqual(result, { ok: true, fields: ["seq", "ledger", "function"] });
  });

  it("trims whitespace and drops empty segments", () => {
    const result = parseFieldSelection(" seq , ledger ,,function ");
    assert.deepEqual(result, { ok: true, fields: ["seq", "ledger", "function"] });
  });

  it("deduplicates while preserving order", () => {
    const result = parseFieldSelection("ledger,seq,ledger");
    assert.deepEqual(result, { ok: true, fields: ["ledger", "seq"] });
  });

  it("rejects an unknown field and lists the allowed set", () => {
    const result = parseFieldSelection("seq,password_hash");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_fields");
    assert.match(result.message, /password_hash/);
    assert.deepEqual(result.allowed, [...EVENT_SELECTABLE_FIELDS]);
  });

  it("rejects empty and whitespace-only input", () => {
    for (const raw of ["", "   ", ",", ",,,"]) {
      const result = parseFieldSelection(raw);
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_fields");
    }
  });

  it("rejects non-string input", () => {
    assert.equal(parseFieldSelection(undefined).ok, false);
    assert.equal(parseFieldSelection(null).ok, false);
  });

  it("enforces the maximum number of selected fields (query-cost bound)", () => {
    const many = EVENT_SELECTABLE_FIELDS.join(",");
    const result = parseFieldSelection(many, { max: 3 });
    assert.equal(result.ok, false);
    assert.equal(result.error, "too_many_fields");
    assert.match(result.message, /At most 3 fields/);
  });

  it("accepts exactly the maximum number of fields", () => {
    const result = parseFieldSelection("seq,ledger,function", { max: 3 });
    assert.equal(result.ok, true);
    assert.equal(result.fields.length, 3);
  });

  it("never lets a caller request a field outside the allowlist", () => {
    const result = parseFieldSelection("seq,needs_redecode,lineage_batch_id");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_fields");
  });
});

describe("projectEvent / projectEvents (#1078)", () => {
  const event = {
    seq: 7,
    contract_id: "CABC",
    function: "transfer",
    ledger: 1007,
    description: "transfer 5 units",
    raw_data: "{}",
    needs_redecode: true,
  };

  it("keeps only the requested fields", () => {
    assert.deepEqual(projectEvent(event, ["seq", "function"]), { seq: 7, function: "transfer" });
  });

  it("omits requested fields that are absent from the source", () => {
    assert.deepEqual(projectEvent(event, ["seq", "fee_charged"]), { seq: 7 });
  });

  it("does not leak unselected fields", () => {
    const projected = projectEvent(event, ["seq"]);
    assert.equal("needs_redecode" in projected, false);
    assert.equal("raw_data" in projected, false);
  });

  it("returns the input untouched when no fields are selected", () => {
    const events = [event];
    assert.equal(projectEvents(events, undefined), events);
    assert.equal(projectEvents(events, []), events);
  });

  it("projects every event in a page", () => {
    const projected = projectEvents([event, { ...event, seq: 8 }], ["seq", "ledger"]);
    assert.deepEqual(projected, [
      { seq: 7, ledger: 1007 },
      { seq: 8, ledger: 1007 },
    ]);
  });

  it("tolerates non-object entries", () => {
    assert.deepEqual(projectEvent(null, ["seq"]), {});
    assert.deepEqual(projectEvent("nope", ["seq"]), {});
  });
});
