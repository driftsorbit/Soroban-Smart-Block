// Tests for immutable ABI version permalinks (issue #1053).
// Target module: indexer/src/abiPermalinks.js (not yet implemented).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAbiPermalink, parseAbiPermalink, resolveAbiPermalink } from "../src/abiPermalinks.js";

const CONTRACT = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const BASE = "https://explorer.example";

test("builds a versioned permalink path", () => {
  assert.equal(
    buildAbiPermalink(BASE, CONTRACT, 3),
    `${BASE}/api/contracts/${CONTRACT}/abi/versions/3`,
  );
});

test("parses a permalink back into contract id and version", () => {
  const url = buildAbiPermalink(BASE, CONTRACT, 3);
  assert.deepEqual(parseAbiPermalink(url), { contractId: CONTRACT, abiVersion: 3 });
});

test("parse returns null for non-permalink URLs", () => {
  assert.equal(parseAbiPermalink(`${BASE}/api/contracts/${CONTRACT}/abi`), null);
  assert.equal(parseAbiPermalink("not a url"), null);
});

test("parse rejects non-integer or negative versions", () => {
  assert.equal(parseAbiPermalink(`${BASE}/api/contracts/${CONTRACT}/abi/versions/1.5`), null);
  assert.equal(parseAbiPermalink(`${BASE}/api/contracts/${CONTRACT}/abi/versions/-1`), null);
  assert.equal(parseAbiPermalink(`${BASE}/api/contracts/${CONTRACT}/abi/versions/abc`), null);
});

test("build rejects invalid versions", () => {
  assert.throws(() => buildAbiPermalink(BASE, CONTRACT, 0), RangeError);
  assert.throws(() => buildAbiPermalink(BASE, CONTRACT, "2"), TypeError);
});

test("resolve returns the stored snapshot for an existing version", async () => {
  const snapshot = { abi_version: 2, functions: [{ name: "transfer", params: [] }] };
  const store = { getAbiVersion: async (id, v) => (id === CONTRACT && v === 2 ? snapshot : null) };
  assert.deepEqual(await resolveAbiPermalink(store, CONTRACT, 2), snapshot);
});

test("resolve returns null for an unknown version", async () => {
  const store = { getAbiVersion: async () => null };
  assert.equal(await resolveAbiPermalink(store, CONTRACT, 99), null);
});

test("resolve returns the same snapshot after the contract's ABI is updated", async () => {
  // Immutability: a later update must not change what an older permalink returns.
  const rows = new Map([[1, { abi_version: 1, functions: [{ name: "a", params: [] }] }]]);
  const store = { getAbiVersion: async (_id, v) => rows.get(v) ?? null };
  const before = await resolveAbiPermalink(store, CONTRACT, 1);
  rows.set(2, { abi_version: 2, functions: [{ name: "b", params: [] }] });
  assert.deepEqual(await resolveAbiPermalink(store, CONTRACT, 1), before);
});
