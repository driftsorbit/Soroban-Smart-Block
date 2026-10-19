import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { pool, db, getEventDecodeProvenance, attachDecodeProvenance } from "../../src/db.js";

describe("Features #1070, #1071, #1072, #1073", () => {
  let originalPoolQuery;

  beforeEach(() => {
    originalPoolQuery = pool.query;
  });

  afterEach(() => {
    pool.query = originalPoolQuery;
  });

  // =========================================================================
  // #1071: Expose event decode provenance in REST responses
  // =========================================================================
  describe("#1071: Event Decode Provenance", () => {
    it("parses standard decoder tag and builds provenance object", () => {
      const event = {
        decoder_version: "sep41@1.2.0",
        abi_version: 3,
        decode_status: "verified",
      };
      const provenance = getEventDecodeProvenance(event);
      assert.deepEqual(provenance, {
        decoder: "sep41",
        decoder_version: "1.2.0",
        abi_version: 3,
        decode_status: "verified",
      });
    });

    it("handles decoder tag without version", () => {
      const event = {
        decoder_version: "custom_parser",
        abi_version: null,
      };
      const provenance = getEventDecodeProvenance(event);
      assert.deepEqual(provenance, {
        decoder: "custom_parser",
        decoder_version: null,
        abi_version: null,
        decode_status: "unverified",
      });
    });

    it("handles missing/null decoder fields gracefully", () => {
      assert.equal(getEventDecodeProvenance(null), null);
      assert.equal(getEventDecodeProvenance(undefined), null);
      assert.equal(getEventDecodeProvenance("not-an-object"), null);

      const emptyEvent = {};
      const provenance = getEventDecodeProvenance(emptyEvent);
      assert.deepEqual(provenance, {
        decoder: null,
        decoder_version: null,
        abi_version: null,
        decode_status: "unverified",
      });
    });

    it("attaches decode provenance to an event row", () => {
      const rawEvent = {
        seq: 101,
        contract_id: "CA123",
        function: "transfer",
        decoder_version: "blend@2.0.1",
        abi_version: "4",
      };

      const enriched = attachDecodeProvenance(rawEvent);
      assert.equal(enriched.seq, 101);
      assert.equal(enriched.decoder, "blend");
      assert.equal(enriched.abi_version, 4);
      assert.equal(enriched.decode_status, "unverified");
      assert.deepEqual(enriched.decode_provenance, {
        decoder: "blend",
        decoder_version: "2.0.1",
        abi_version: 4,
        decode_status: "unverified",
      });
    });

    it("attaches decode provenance in db.getEvent", async () => {
      pool.query = async (sql) => {
        if (typeof sql === "string" && sql.includes("FROM events WHERE seq = $1")) {
          return {
            rows: [
              {
                seq: 42,
                contract_id: "CA42",
                decoder_version: "sep41@0.5.0",
                decode_status: "verified",
              },
            ],
          };
        }
        return { rows: [] };
      };

      const event = await db.getEvent(42);
      assert.ok(event);
      assert.equal(event.seq, 42);
      assert.equal(event.decoder, "sep41");
      assert.ok(event.decode_provenance);
      assert.equal(event.decode_provenance.decoder, "sep41");
      assert.equal(event.decode_provenance.decoder_version, "0.5.0");
      assert.equal(event.decode_provenance.decode_status, "verified");
    });
  });

  // =========================================================================
  // #1070: Add an as-of-ledger parameter to analytics endpoints
  // =========================================================================
  describe("#1070: as_of_ledger Analytics Parameter", () => {
    it("getContractStats queries without ledger bound when asOfLedger is omitted", async () => {
      const queries = [];
      pool.query = async (sql, params) => {
        queries.push({ sql, params });
        if (typeof sql === "string" && sql.includes("SELECT COUNT(*)::INT AS total_events")) {
          return {
            rows: [
              {
                total_events: 15,
                first_seen_ledger: 100,
                last_seen_ledger: 4500,
              },
            ],
          };
        }
        if (typeof sql === "string" && sql.includes("unique_callers")) {
          return { rows: [{ unique_callers: 3 }] };
        }
        return { rows: [] };
      };

      const stats = await db.getContractStats("CA123");
      assert.equal(stats.total_events, 15);
      assert.equal(stats.unique_callers, 3);
      assert.equal(stats.as_of_ledger, null);
      assert.equal(stats.watermark, 4500);

      const eventsQuery = queries.find((q) => q.sql.includes("total_events"));
      assert.ok(eventsQuery);
      assert.ok(!eventsQuery.sql.includes("ledger <="));
    });

    it("getContractStats queries with ledger bound when asOfLedger is provided", async () => {
      const queries = [];
      pool.query = async (sql, params) => {
        queries.push({ sql, params });
        if (typeof sql === "string" && sql.includes("SELECT COUNT(*)::INT AS total_events")) {
          return {
            rows: [
              {
                total_events: 10,
                first_seen_ledger: 100,
                last_seen_ledger: 2000,
              },
            ],
          };
        }
        if (typeof sql === "string" && sql.includes("unique_callers")) {
          return { rows: [{ unique_callers: 2 }] };
        }
        return { rows: [] };
      };

      const stats = await db.getContractStats("CA123", 2500);
      assert.equal(stats.total_events, 10);
      assert.equal(stats.unique_callers, 2);
      assert.equal(stats.as_of_ledger, 2500);
      assert.equal(stats.watermark, 2000);

      const eventsQuery = queries.find((q) => q.sql.includes("total_events"));
      assert.ok(eventsQuery);
      assert.ok(eventsQuery.sql.includes("ledger <= $2"));
      assert.equal(eventsQuery.params[1], 2500);
    });

    it("getNftCollectionAnalytics bounds by asOfLedger and returns watermark", async () => {
      const queries = [];
      pool.query = async (sql, params) => {
        queries.push({ sql, params });
        if (typeof sql === "string" && sql.includes("COUNT(*) FILTER (WHERE function IN ('mint_nft', 'create'))")) {
          return { rows: [{ minted: 50, transfers: 10, watermark: 8000 }] };
        }
        if (typeof sql === "string" && sql.includes("unique_holders")) {
          return { rows: [{ unique_holders: 20 }] };
        }
        if (typeof sql === "string" && sql.includes("GROUP BY date")) {
          return { rows: [{ date: "2026-03-01", count: 10 }] };
        }
        return { rows: [] };
      };

      const analytics = await db.getNftCollectionAnalytics("CNFT123", 30, 7500);
      assert.equal(analytics.as_of_ledger, 7500);
      assert.equal(analytics.watermark, 8000);
      assert.equal(analytics.totals.minted, 50);
      assert.equal(analytics.totals.transfers, 10);
      assert.equal(analytics.totals.unique_holders, 20);

      const mintsQuery = queries.find((q) => q.sql.includes("COUNT(*) FILTER"));
      assert.ok(mintsQuery);
      assert.ok(mintsQuery.sql.includes("ledger <="));
    });

    it("getContractEventsByDay queries with ledger bound when asOfLedger is provided", async () => {
      const queries = [];
      pool.query = async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [{ date: new Date("2026-03-01T00:00:00.000Z"), count: 12 }] };
      };

      const series = await db.getContractEventsByDay("CA123", 14, 3000);
      assert.ok(Array.isArray(series));
      assert.equal(series[0].date, "2026-03-01");
      assert.equal(series[0].count, 12);
      const q = queries[0];
      assert.ok(q.sql.includes("ledger <= $3"));
      assert.equal(q.params[2], 3000);
    });
  });

  // =========================================================================
  // #1072: Transaction events endpoint with stable ordering
  // =========================================================================
  describe("#1072: Transaction Events", () => {
    it("getTransactionEvents orders deterministically by seq ASC by default", async () => {
      let executedSql = "";
      let queryParams = [];
      pool.query = async (sql, params) => {
        if (sql.includes("COUNT(*)")) {
          return { rows: [{ total: 2 }] };
        }
        executedSql = sql;
        queryParams = params;
        return {
          rows: [
            { seq: 10, tx_hash: "abc1234", function: "mint", decoder_version: "nft@1.0.0" },
            { seq: 11, tx_hash: "abc1234", function: "transfer", decoder_version: "nft@1.0.0" },
          ],
        };
      };

      const result = await db.getTransactionEvents("abc1234", { limit: 20, offset: 5, order: "asc" });
      assert.ok(executedSql.includes("ORDER BY seq ASC"));
      assert.ok(executedSql.includes("LIMIT $2 OFFSET $3"));
      assert.deepEqual(queryParams, ["abc1234", 20, 5]);
      assert.equal(result.total, 2);
      assert.equal(result.events.length, 2);
      assert.equal(result.events[0].seq, 10);
      assert.equal(result.events[0].decode_provenance.decoder, "nft");
      assert.equal(result.events[1].seq, 11);
    });

    it("getTransactionEvents supports DESC ordering and bounds limit to 200", async () => {
      let executedSql = "";
      let queryParams = [];
      pool.query = async (sql, params) => {
        if (sql.includes("COUNT(*)")) {
          return { rows: [{ total: 0 }] };
        }
        executedSql = sql;
        queryParams = params;
        return { rows: [] };
      };

      const result = await db.getTransactionEvents("def5678", { limit: 500, offset: 0, order: "desc" });
      assert.ok(executedSql.includes("ORDER BY seq DESC"));
      assert.equal(queryParams[1], 200); // clamped to 200
      assert.deepEqual(result.events, []);
      assert.equal(result.total, 0);
    });
  });

  // =========================================================================
  // #1073: Contract activity summary endpoint
  // =========================================================================
  describe("#1073: Contract Activity Summary", () => {
    it("getContractActivitySummary calculates breakdown and partial data indicator", async () => {
      pool.query = async (sql, _params) => {
        if (sql.includes("watermark") && sql.includes("first_seen_ledger")) {
          return {
            rows: [
              {
                total_events: 100,
                watermark: 10000,
                first_seen_ledger: 500,
                first_event_time: new Date(Date.now() - 3600000).toISOString(),
              },
            ],
          };
        }
        if (sql.includes("GROUP BY function")) {
          return {
            rows: [
              { function: "transfer", count: 70 },
              { function: "approve", count: 30 },
            ],
          };
        }
        if (sql.includes("GROUP BY bucket")) {
          return {
            rows: [
              { bucket: new Date().toISOString(), function: "transfer", count: 60 },
              { bucket: new Date().toISOString(), function: "approve", count: 40 },
            ],
          };
        }
        return { rows: [] };
      };

      const summary = await db.getContractActivitySummary("CA_CONTRACT", {
        interval: "day",
        range: 7,
      });

      assert.equal(summary.contract_id, "CA_CONTRACT");
      assert.equal(summary.interval, "day");
      assert.equal(summary.range, 7);
      assert.equal(summary.total_events, 100);
      assert.equal(summary.watermark, 10000);
      assert.equal(summary.by_function.length, 2);
      assert.equal(summary.by_function[0].function, "transfer");
      assert.equal(summary.by_function[0].count, 70);
      assert.equal(summary.intervals.length, 7);
      assert.ok(summary.partial_indicators);
      assert.equal(typeof summary.partial_data, "boolean");
    });

    it("getContractActivitySummary handles hour and week intervals properly", async () => {
      pool.query = async (sql) => {
        if (sql.includes("watermark") && sql.includes("first_seen_ledger")) {
          return {
            rows: [
              {
                total_events: 5,
                watermark: 500,
                first_seen_ledger: 400,
                first_event_time: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      };

      const hourSummary = await db.getContractActivitySummary("CA_CONTRACT", {
        interval: "hour",
        range: 24,
      });
      assert.equal(hourSummary.interval, "hour");
      assert.equal(hourSummary.range, 24);
      assert.equal(hourSummary.intervals.length, 24);

      const weekSummary = await db.getContractActivitySummary("CA_CONTRACT", {
        interval: "week",
        range: 4,
      });
      assert.equal(weekSummary.interval, "week");
      assert.equal(weekSummary.range, 4);
      assert.equal(weekSummary.intervals.length, 4);
    });

    it("returns zeroes and empty lists when no contract activity exists", async () => {
      pool.query = async (sql, _params) => {
        if (sql.includes("watermark") && sql.includes("first_seen_ledger")) {
          return {
            rows: [
              {
                total_events: 0,
                watermark: null,
                first_seen_ledger: null,
                first_event_time: null,
              },
            ],
          };
        }
        if (sql.includes("GROUP BY function")) {
          return { rows: [] };
        }
        if (sql.includes("GROUP BY bucket")) {
          return { rows: [] };
        }
        return { rows: [] };
      };

      const summary = await db.getContractActivitySummary("CA_EMPTY");
      assert.equal(summary.total_events, 0);
      assert.deepEqual(summary.by_function, []);
      assert.equal(summary.watermark, null);
    });
  });

  // =========================================================================
  // HTTP Route Handling & Parameter Validation Integration
  // =========================================================================
  describe("API Endpoint Validation & Routing Integration", () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());

      // Mount route handlers replicating src/api.js logic with db
      // GET /api/tx/:hash/events
      const txEventsHandler = async (req, res) => {
        try {
          const { hash } = req.params;
          if (!hash || typeof hash !== "string" || hash.trim().length === 0) {
            return res.status(422).json({ error: "Invalid transaction hash" });
          }
          if (req.query.limit !== undefined) {
            const parsedLimit = Number(req.query.limit);
            if (isNaN(parsedLimit) || parsedLimit <= 0 || parsedLimit > 200 || !Number.isInteger(parsedLimit)) {
              return res.status(422).json({ error: "Invalid limit" });
            }
          }
          if (req.query.offset !== undefined) {
            const parsedOffset = Number(req.query.offset);
            if (isNaN(parsedOffset) || parsedOffset < 0 || !Number.isInteger(parsedOffset)) {
              return res.status(422).json({ error: "Invalid offset" });
            }
          }
          if (req.query.order !== undefined) {
            const ord = String(req.query.order).toLowerCase();
            if (!["asc", "desc"].includes(ord)) {
              return res.status(422).json({ error: "Invalid order" });
            }
          }
          const limit = req.query.limit !== undefined ? Number(req.query.limit) : 50;
          const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
          const order = req.query.order || "asc";
          const result = await db.getTransactionEvents(hash.trim(), { limit, offset, order });
          res.json(result);
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      };
      app.get("/api/tx/:hash/events", txEventsHandler);
      app.get("/api/transactions/:hash/events", txEventsHandler);

      // GET /api/events/:seq/decode-provenance
      app.get("/api/events/:seq/decode-provenance", async (req, res) => {
        try {
          const seq = Number(req.params.seq);
          if (!Number.isSafeInteger(seq) || seq < 1) {
            return res.status(422).json({ error: "Invalid sequence number" });
          }
          const event = await db.getEvent(seq);
          if (!event) {
            return res.status(404).json({ error: "Event not found" });
          }
          const provenance = db.getEventDecodeProvenance(event);
          res.json({
            seq: event.seq,
            contract_id: event.contract_id,
            function: event.function,
            ledger: event.ledger,
            ...provenance,
          });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      });

      // GET /api/contracts/:id/activity-summary
      const contractActivitySummaryHandler = async (req, res) => {
        try {
          const { id: contractId } = req.params;
          if (!contractId || typeof contractId !== "string" || contractId.trim().length === 0) {
            return res.status(422).json({ error: "Invalid contract ID" });
          }
          const interval = req.query.interval !== undefined ? String(req.query.interval).toLowerCase() : "day";
          if (!["hour", "day", "week"].includes(interval)) {
            return res.status(422).json({ error: "Invalid interval. Must be one of: hour, day, week" });
          }
          const limits = {
            hour: { min: 1, max: 168 },
            day: { min: 1, max: 90 },
            week: { min: 1, max: 52 },
          };
          let range = undefined;
          if (req.query.range !== undefined) {
            range = Number(req.query.range);
            if (!Number.isInteger(range) || range < limits[interval].min || range > limits[interval].max) {
              return res.status(422).json({
                error: `Invalid range for interval '${interval}'. Must be between ${limits[interval].min} and ${limits[interval].max}`,
              });
            }
          }
          const asOfLedgerRaw = req.query.as_of_ledger ?? req.query["as-of-ledger"];
          let asOfLedger = null;
          if (asOfLedgerRaw !== undefined) {
            asOfLedger = Number(asOfLedgerRaw);
            if (!Number.isInteger(asOfLedger) || asOfLedger < 0) {
              return res.status(422).json({ error: "Invalid as_of_ledger" });
            }
          }
          const summary = await db.getContractActivitySummary(contractId.trim(), {
            interval,
            range,
            asOfLedger,
          });
          res.json(summary);
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      };
      app.get("/api/contracts/:id/activity-summary", contractActivitySummaryHandler);

      // GET /api/tokens/:contractId/nfts/analytics
      const nftAnalyticsHandler = async (req, res) => {
        try {
          const { contractId } = req.params;
          const days = req.query.days !== undefined ? Number(req.query.days) : 30;
          if (isNaN(days) || days < 1 || days > 365) {
            return res.status(422).json({ error: "Invalid days" });
          }
          const asOfLedgerRaw = req.query.as_of_ledger ?? req.query["as-of-ledger"];
          let asOfLedger = null;
          if (asOfLedgerRaw !== undefined) {
            asOfLedger = Number(asOfLedgerRaw);
            if (!Number.isInteger(asOfLedger) || asOfLedger < 0) {
              return res.status(422).json({ error: "Invalid as_of_ledger" });
            }
          }
          const analytics = await db.getNftCollectionAnalytics(contractId, days, asOfLedger);
          res.json(analytics);
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      };
      app.get("/api/tokens/:contractId/nfts/analytics", nftAnalyticsHandler);

      // GET /api/contracts/:id/stats
      app.get("/api/contracts/:id/stats", async (req, res) => {
        try {
          const asOfLedgerRaw = req.query.as_of_ledger ?? req.query["as-of-ledger"];
          let asOfLedger = null;
          if (asOfLedgerRaw !== undefined) {
            asOfLedger = Number(asOfLedgerRaw);
            if (!Number.isInteger(asOfLedger) || asOfLedger < 0) {
              return res.status(422).json({ error: "Invalid as_of_ledger" });
            }
          }
          const stats = await db.getContractStats(req.params.id, asOfLedger);
          res.json({
            ...stats,
            as_of_ledger: asOfLedger,
            watermark: stats.watermark,
          });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      });
    });

    it("rejects invalid transaction events parameters", async () => {
      let res = await request(app).get("/api/tx/abc/events?limit=0");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/tx/abc/events?limit=300");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/tx/abc/events?offset=-1");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/tx/abc/events?order=invalid");
      assert.equal(res.status, 422);
    });

    it("accepts valid transaction events request and supports /transactions alias", async () => {
      pool.query = async (sql) => {
        if (sql.includes("COUNT(*)")) {
          return { rows: [{ total: 1 }] };
        }
        return {
          rows: [{ seq: 1, tx_hash: "tx100", decoder_version: "token@1.0.0" }],
        };
      };

      const res1 = await request(app).get("/api/tx/tx100/events?limit=10&order=desc");
      assert.equal(res1.status, 200);
      assert.equal(res1.body.events.length, 1);
      assert.equal(res1.body.events[0].seq, 1);
      assert.equal(res1.body.events[0].decode_provenance.decoder, "token");
      assert.equal(res1.body.total, 1);

      const res2 = await request(app).get("/api/transactions/tx100/events");
      assert.equal(res2.status, 200);
      assert.equal(res2.body.events.length, 1);
    });

    it("validates seq and returns decode provenance for an event", async () => {
      let res = await request(app).get("/api/events/invalid/decode-provenance");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/events/-5/decode-provenance");
      assert.equal(res.status, 422);

      pool.query = async (sql) => {
        if (typeof sql === "string" && sql.includes("FROM events WHERE seq = $1")) {
          return { rows: [] };
        }
        return { rows: [] };
      };
      res = await request(app).get("/api/events/99999/decode-provenance");
      assert.equal(res.status, 404);

      pool.query = async (sql) => {
        if (typeof sql === "string" && sql.includes("FROM events WHERE seq = $1")) {
          return {
            rows: [
              {
                seq: 123,
                contract_id: "CAXYZ",
                function: "swap",
                ledger: 10500,
                decoder_version: "stellarswap@1.0.0",
                abi_version: 2,
                decode_status: "verified",
              },
            ],
          };
        }
        return { rows: [] };
      };
      res = await request(app).get("/api/events/123/decode-provenance");
      assert.equal(res.status, 200);
      assert.equal(res.body.seq, 123);
      assert.equal(res.body.decoder, "stellarswap");
      assert.equal(res.body.decoder_version, "1.0.0");
      assert.equal(res.body.abi_version, 2);
      assert.equal(res.body.decode_status, "verified");
    });

    it("validates parameters on contract activity summary endpoint", async () => {
      let res = await request(app).get("/api/contracts/CA1/activity-summary?interval=century");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/contracts/CA1/activity-summary?interval=hour&range=200");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/contracts/CA1/activity-summary?interval=day&range=100");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/contracts/CA1/activity-summary?as_of_ledger=-5");
      assert.equal(res.status, 422);
    });

    it("validates as_of_ledger on NFT analytics and contract stats endpoints", async () => {
      let res = await request(app).get("/api/tokens/CA1/nfts/analytics?as_of_ledger=invalid");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/tokens/CA1/nfts/analytics?as-of-ledger=-10");
      assert.equal(res.status, 422);

      res = await request(app).get("/api/contracts/CA1/stats?as_of_ledger=not-a-number");
      assert.equal(res.status, 422);
    });
  });
});
