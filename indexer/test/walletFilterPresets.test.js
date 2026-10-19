import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PRESET_NAME_LENGTH,
  MAX_SHARE_TOKEN_LENGTH,
  validatePreset,
  encodeShareToken,
  decodeShareToken,
} from "../src/walletFilterPresets.js";

describe("validatePreset", () => {
  it("accepts a named preset and normalises its fields", () => {
    const result = validatePreset({
      name: "  Monthly transfers ",
      fn: " Transfer, MINT ,transfer",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    assert.deepEqual(result, {
      ok: true,
      preset: { name: "Monthly transfers", fn: "transfer,mint", from: "2026-01-01", to: "2026-01-31" },
    });
  });

  it("treats a missing fn and missing dates as no filter", () => {
    assert.deepEqual(validatePreset({ name: "All activity" }), {
      ok: true,
      preset: { name: "All activity", fn: null, from: null, to: null },
    });
  });

  it("requires a non-blank name", () => {
    assert.deepEqual(validatePreset({ name: "   " }), { ok: false, errors: ["name is required"] });
    assert.equal(validatePreset({}).ok, false);
  });

  it("rejects names longer than the limit", () => {
    const result = validatePreset({ name: "x".repeat(MAX_PRESET_NAME_LENGTH + 1) });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /at most 60/);
  });

  it("reports invalid category tokens by name", () => {
    const result = validatePreset({ name: "p", fn: "transfer,drop table" });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /drop table/);
  });

  it("rejects more than ten categories", () => {
    const fn = Array.from({ length: 11 }, (_, i) => `cat${String.fromCharCode(97 + i)}`).join(",");
    const result = validatePreset({ name: "p", fn });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /at most 10/);
  });

  it("rejects malformed dates and a from date after to", () => {
    const result = validatePreset({ name: "p", from: "2026-02-01", to: "2026-01-01" });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /on or before/);
    assert.equal(validatePreset({ name: "p", from: "bad" }).ok, false);
  });

  it("collects every problem in one response", () => {
    const result = validatePreset({ name: "", fn: 42, from: "nope" });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 3);
  });

  it("rejects non-object bodies", () => {
    assert.deepEqual(validatePreset(null), { ok: false, errors: ["preset must be an object"] });
    assert.deepEqual(validatePreset(["x"]), { ok: false, errors: ["preset must be an object"] });
  });
});

describe("share tokens", () => {
  const preset = { name: "Transfers", fn: "transfer", from: "2026-01-01", to: null };

  it("round-trips a preset through encode and decode", () => {
    const token = encodeShareToken(preset);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeShareToken(token), { ok: true, preset });
  });

  it("rejects a missing or oversized token", () => {
    assert.equal(decodeShareToken(undefined).ok, false);
    assert.equal(decodeShareToken("a".repeat(MAX_SHARE_TOKEN_LENGTH + 1)).ok, false);
  });

  it("rejects text that is not a token", () => {
    assert.deepEqual(decodeShareToken("!!!not-base64-json"), {
      ok: false,
      errors: ["token is not a valid preset share token"],
    });
  });

  it("rejects an unknown token version", () => {
    const token = Buffer.from(JSON.stringify({ v: 2, name: "x" }), "utf8").toString("base64url");
    assert.deepEqual(decodeShareToken(token), { ok: false, errors: ["token version is not supported"] });
  });

  it("re-validates decoded contents, so a hand-made token cannot skip checks", () => {
    const token = Buffer.from(JSON.stringify({ v: 1, name: "", fn: "bad fn!" }), "utf8").toString("base64url");
    const result = decodeShareToken(token);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  });
});
