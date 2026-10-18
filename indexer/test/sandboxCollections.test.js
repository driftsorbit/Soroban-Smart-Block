import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeSecrets,
  validateScenarioItem,
  saveCollection,
  getCollection,
  listCollections,
  deleteCollection,
  exportCollection,
  importCollection,
} from "../src/sandboxCollections.js";

const VALID_CONTRACT = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOVO55TXU64G2K6";
const FAKE_SECRET_KEY = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("sandboxCollections (#1092)", () => {
  describe("Secret Sanitization", () => {
    it("strips Stellar private keys from strings and nested objects", () => {
      const data = {
        name: "Test Collection",
        secretVal: FAKE_SECRET_KEY,
        nested: {
          embeddedKey: `Secret is ${FAKE_SECRET_KEY}`,
          regularField: "regular value",
        },
      };

      const { sanitized, strippedCount } = sanitizeSecrets(data);
      assert.equal(strippedCount >= 2, true);
      assert.equal(sanitized.secretVal, undefined); // Sensitive key dropped
      assert.equal(sanitized.nested.embeddedKey.includes(FAKE_SECRET_KEY), false);
      assert.equal(sanitized.nested.embeddedKey.includes("[REDACTED_SECRET_KEY]"), true);
      assert.equal(sanitized.nested.regularField, "regular value");
    });

    it("drops sensitive property names (password, privateKey, seed, token)", () => {
      const data = {
        name: "Safe Collection",
        password: "my-password-123",
        privateKey: "0xdeadbeef",
        seed: "word1 word2",
        auth_token: "jwt-token",
        scenarios: [],
      };

      const { sanitized, strippedCount } = sanitizeSecrets(data);
      assert.equal(strippedCount, 4);
      assert.equal("password" in sanitized, false);
      assert.equal("privateKey" in sanitized, false);
      assert.equal("seed" in sanitized, false);
      assert.equal("auth_token" in sanitized, false);
      assert.equal(sanitized.name, "Safe Collection");
    });
  });

  describe("Validation", () => {
    it("validates valid scenario items", () => {
      const item = validateScenarioItem({
        contractId: VALID_CONTRACT,
        fn: "transfer",
        args: ["GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", 100],
      });
      assert.equal(item.contractId, VALID_CONTRACT);
      assert.equal(item.fn, "transfer");
      assert.equal(Array.isArray(item.args), true);
    });

    it("rejects invalid scenario items", () => {
      assert.throws(() => validateScenarioItem(null), /valid object/);
      assert.throws(() => validateScenarioItem({ fn: "test" }), /valid contractId/);
      assert.throws(() => validateScenarioItem({ contractId: VALID_CONTRACT }), /valid fn/);
      assert.throws(
        () => validateScenarioItem({ contractId: VALID_CONTRACT, fn: "test", args: 123 }),
        /array or JSON string/,
      );
    });

    it("rejects collection with empty name", async () => {
      await assert.rejects(() => saveCollection({ name: "" }), /Collection name is required/);
      await assert.rejects(() => saveCollection(null), /valid JSON object/);
    });
  });

  describe("Collection CRUD operations", () => {
    it("creates, retrieves, lists, and deletes named scenario collections", async () => {
      const saveRes = await saveCollection({
        name: "Token Suite",
        description: "SEP-41 testing suite",
        scenarios: [
          {
            name: "Transfer 50 tokens",
            contractId: VALID_CONTRACT,
            fn: "transfer",
            args: ["GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", 50],
          },
        ],
      });

      assert.ok(saveRes.collection.id);
      assert.equal(saveRes.collection.name, "Token Suite");
      assert.equal(saveRes.collection.scenarios.length, 1);

      // Get
      const col = await getCollection(saveRes.collection.id);
      assert.ok(col);
      assert.equal(col.name, "Token Suite");

      // List
      const list = await listCollections({ limit: 10 });
      assert.ok(list.collections.length > 0);
      assert.ok(list.collections.some((c) => c.id === saveRes.collection.id));

      // Delete
      const del = await deleteCollection(saveRes.collection.id);
      assert.equal(del.deleted, true);

      // Verify deletion
      const colAfter = await getCollection(saveRes.collection.id);
      assert.equal(colAfter, null);
    });
  });

  describe("Export and Import", () => {
    it("exports collection safely without secrets", async () => {
      const saveRes = await saveCollection({
        name: "Export Test",
        secretKey: FAKE_SECRET_KEY,
        scenarios: [
          {
            contractId: VALID_CONTRACT,
            fn: "mint",
            args: ["GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", 1000],
          },
        ],
      });

      const exported = await exportCollection(saveRes.collection.id);
      assert.equal(exported.version, 1);
      assert.equal(exported.schema, "soroban-sandbox-collection-v1");
      assert.ok(exported.collection);
      assert.equal("secretKey" in exported.collection, false);
      assert.equal(JSON.stringify(exported).includes(FAKE_SECRET_KEY), false);
    });

    it("imports collection and strips any secret keys present", async () => {
      const importPayload = {
        name: "Third-Party Collection",
        privateKey: "sensitive-seed",
        scenarios: [
          {
            contractId: VALID_CONTRACT,
            fn: "transfer",
            args: [`Secret: ${FAKE_SECRET_KEY}`],
          },
        ],
      };

      const res = await importCollection(importPayload);
      assert.equal(res.success, true);
      assert.ok(res.collection.id);
      assert.ok(res.strippedSecretsCount > 0);
      assert.equal(JSON.stringify(res.collection).includes(FAKE_SECRET_KEY), false);
    });

    it("rejects invalid import payloads", async () => {
      await assert.rejects(() => importCollection(null), /cannot be empty/);
      await assert.rejects(() => importCollection("invalid-json{"), /valid JSON/);
      await assert.rejects(() => importCollection({ scenarios: "not an array" }), /must be an array/);
    });
  });
});
