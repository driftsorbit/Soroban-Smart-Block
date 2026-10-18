import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { replayScenario } from "../src/sandboxReplay.js";
import { compareProtocolSimulations } from "../src/sandboxProtocols.js";
import {
  listCollections,
  saveCollection,
  getCollection,
  deleteCollection,
  exportCollection,
  importCollection,
} from "../src/sandboxCollections.js";
import { validateAuthRequirements } from "../src/sandboxAuthValidator.js";

const VALID_CONTRACT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";
const ACCOUNT_A = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";

function createApp() {
  const app = express();
  app.use(express.json());

  // Mount identical route handlers as api.js
  app.post("/api/sandbox/replay", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Missing scenario payload" });
      }
      const result = await replayScenario(req.body);
      res.json(result);
    } catch (e) {
      const status =
        e.message.includes("required") || e.message.includes("must be") || e.message.includes("Invalid") ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  });

  app.post("/api/sandbox/compare-protocols", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Missing request body" });
      }
      const result = await compareProtocolSimulations(req.body);
      res.json(result);
    } catch (e) {
      const status =
        e.message.includes("required") ||
        e.message.includes("must be") ||
        e.message.includes("Unsupported") ||
        e.message.includes("empty")
          ? 400
          : 500;
      res.status(status).json({ error: e.message });
    }
  });

  app.get("/api/sandbox/collections", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit || "50", 10);
      const offset = parseInt(req.query.offset || "0", 10);
      res.json(await listCollections({ limit, offset }));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/sandbox/collections", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Missing collection payload" });
      }
      const result = await saveCollection(req.body);
      res.status(201).json(result);
    } catch (e) {
      const status =
        e.message.includes("required") || e.message.includes("must be") || e.message.includes("Invalid") ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  });

  app.get("/api/sandbox/collections/:id", async (req, res) => {
    try {
      const collection = await getCollection(req.params.id);
      if (!collection) {
        return res.status(404).json({ error: `Scenario collection not found: ${req.params.id}` });
      }
      res.json(collection);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/sandbox/collections/:id", async (req, res) => {
    try {
      const result = await deleteCollection(req.params.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/sandbox/collections/export", async (req, res) => {
    try {
      const target = req.body?.collectionId || req.body?.collection || req.body;
      if (!target || (typeof target === "object" && Object.keys(target).length === 0)) {
        return res.status(400).json({ error: "Missing collection or collectionId for export" });
      }
      const exported = await exportCollection(target);
      res.json(exported);
    } catch (e) {
      const status = e.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  });

  app.post("/api/sandbox/collections/import", async (req, res) => {
    try {
      if (!req.body || (typeof req.body === "object" && Object.keys(req.body).length === 0)) {
        return res.status(400).json({ error: "Missing import data" });
      }
      const imported = await importCollection(req.body);
      res.status(201).json(imported);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/sandbox/validate-auth", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Missing request body" });
      }
      const result = validateAuthRequirements(req.body);
      res.json(result);
    } catch (e) {
      const status = e.message.includes("required") || e.message.includes("must be") ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  });

  return app;
}

describe("Sandbox API HTTP Endpoints (#1090-#1093)", () => {
  const app = createApp();

  describe("POST /api/sandbox/replay (#1090)", () => {
    it("returns 200 with deterministic replay outcome", async () => {
      const res = await request(app)
        .post("/api/sandbox/replay")
        .send({
          contractId: VALID_CONTRACT,
          fn: "calculate",
          args: [1, 2],
          env: { sequence: 100000, timestamp: 1700000000, protocolVersion: 20 },
        })
        .expect(200);

      assert.equal(res.body.success, true);
      assert.equal(res.body.isDeterministic, true);
      assert.equal(res.body.isLedgerDependent, false);
      assert.ok(res.body.replayResult.returnValue);
    });

    it("flags ledger-dependent scenario results", async () => {
      const res = await request(app)
        .post("/api/sandbox/replay")
        .send({
          contractId: VALID_CONTRACT,
          fn: "vesting_check_timelock",
          args: [ACCOUNT_A],
          env: { sequence: 100000, timestamp: 1700000000, protocolVersion: 20 },
        })
        .expect(200);

      assert.equal(res.body.isLedgerDependent, true);
      assert.ok(res.body.warning.includes("Ledger-dependent results"));
    });

    it("returns 400 when scenario payload is empty or invalid", async () => {
      await request(app).post("/api/sandbox/replay").send({}).expect(400);
      await request(app).post("/api/sandbox/replay").send({ contractId: VALID_CONTRACT, fn: "" }).expect(400);
    });
  });

  describe("POST /api/sandbox/compare-protocols (#1091)", () => {
    it("returns 200 with multi-protocol comparison and environment labels", async () => {
      const res = await request(app)
        .post("/api/sandbox/compare-protocols")
        .send({
          contractId: VALID_CONTRACT,
          fn: "transfer",
          args: [ACCOUNT_A, 50],
          protocols: [20, 21, 22],
        })
        .expect(200);

      assert.equal(res.body.success, true);
      assert.equal(res.body.comparisons.length, 3);
      assert.ok(res.body.deltas.length >= 2);
      assert.ok(res.body.comparisons[0].label.includes("Protocol 20"));
    });

    it("returns 400 on unsupported protocol or empty body", async () => {
      await request(app).post("/api/sandbox/compare-protocols").send({}).expect(400);
      await request(app)
        .post("/api/sandbox/compare-protocols")
        .send({
          contractId: VALID_CONTRACT,
          fn: "test",
          protocols: [99],
        })
        .expect(400);
    });
  });

  describe("Scenario Collections Endpoints (#1092)", () => {
    let createdId = "";

    it("creates a collection via POST /api/sandbox/collections", async () => {
      const res = await request(app)
        .post("/api/sandbox/collections")
        .send({
          name: "API Test Collection",
          scenarios: [
            {
              contractId: VALID_CONTRACT,
              fn: "balance",
              args: [ACCOUNT_A],
            },
          ],
        })
        .expect(201);

      assert.ok(res.body.collection.id);
      createdId = res.body.collection.id;
      assert.equal(res.body.collection.name, "API Test Collection");
    });

    it("lists collections via GET /api/sandbox/collections", async () => {
      const res = await request(app).get("/api/sandbox/collections").expect(200);
      assert.ok(Array.isArray(res.body.collections));
      assert.ok(res.body.total >= 1);
    });

    it("retrieves collection by ID via GET /api/sandbox/collections/:id", async () => {
      const res = await request(app).get(`/api/sandbox/collections/${createdId}`).expect(200);
      assert.equal(res.body.id, createdId);
      assert.equal(res.body.name, "API Test Collection");
    });

    it("returns 404 for non-existent collection ID", async () => {
      await request(app).get("/api/sandbox/collections/non-existent-id-9999").expect(404);
    });

    it("exports collection without secrets via POST /api/sandbox/collections/export", async () => {
      const res = await request(app)
        .post("/api/sandbox/collections/export")
        .send({ collectionId: createdId })
        .expect(200);

      assert.equal(res.body.version, 1);
      assert.equal(res.body.collection.id, createdId);
    });

    it("imports collection via POST /api/sandbox/collections/import", async () => {
      const res = await request(app)
        .post("/api/sandbox/collections/import")
        .send({
          name: "Imported API Suite",
          scenarios: [
            {
              contractId: VALID_CONTRACT,
              fn: "mint",
              args: [ACCOUNT_A, 500],
            },
          ],
        })
        .expect(201);

      assert.equal(res.body.success, true);
      assert.ok(res.body.collection.id);
    });

    it("deletes collection via DELETE /api/sandbox/collections/:id", async () => {
      const res = await request(app).delete(`/api/sandbox/collections/${createdId}`).expect(200);
      assert.equal(res.body.deleted, true);
    });
  });

  describe("POST /api/sandbox/validate-auth (#1093)", () => {
    it("returns 200 with valid=true for read-only invocation", async () => {
      const res = await request(app)
        .post("/api/sandbox/validate-auth")
        .send({
          contractId: VALID_CONTRACT,
          fn: "balance",
          args: [ACCOUNT_A],
        })
        .expect(200);

      assert.equal(res.body.valid, true);
      assert.equal(res.body.missing.length, 0);
    });

    it("returns 200 with valid=false and explains missing authorization", async () => {
      const res = await request(app)
        .post("/api/sandbox/validate-auth")
        .send({
          contractId: VALID_CONTRACT,
          fn: "transfer",
          args: [ACCOUNT_A, ACCOUNT_A, 100],
          auth: [],
        })
        .expect(200);

      assert.equal(res.body.valid, false);
      assert.equal(res.body.missing.length, 1);
      assert.equal(res.body.missing[0].signer, ACCOUNT_A);
      assert.ok(res.body.explanation.includes("Missing 1 required authorization entry"));
    });

    it("returns 400 on empty body or missing parameters", async () => {
      await request(app).post("/api/sandbox/validate-auth").send({}).expect(400);
    });
  });
});
