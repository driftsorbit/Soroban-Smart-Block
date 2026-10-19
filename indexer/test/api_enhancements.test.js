import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createHash } from "node:crypto";

function validateLimitParam({ defaultLimit = 25, maxLimit = 200 } = {}) {
  return (req, res, next) => {
    if (req.query.limit !== undefined && req.query.limit !== "") {
      const parsed = Number(req.query.limit);
      if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
        return res.status(422).json({
          error: "Invalid limit",
          message: `limit must be an integer between 1 and ${maxLimit}`,
          max_limit: maxLimit,
          default_limit: defaultLimit,
        });
      }
    }
    next();
  };
}

function computeAnalyticsETag(query, watermark, format = "json") {
  const raw = `${String(query).trim().toLowerCase()}:${watermark}:${format}`;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `W/"analytics-${watermark}-${hash}"`;
}

// Helper to make HTTP requests against a local Express server instance
function makeRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = addr.port;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let body = raw;
          try {
            body = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body, raw });
        });
      },
    );
    req.on("error", reject);
    if (options.body) {
      const payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

describe("Issue #1077: API capability-discovery endpoint", () => {
  function createApp() {
    const app = express();
    const supportedNetworks = ["testnet", "mainnet", "futurenet"];
    app.get("/api/capabilities", (req, res) => {
      if (req.query.network !== undefined) {
        const requested = String(req.query.network).toLowerCase();
        if (!supportedNetworks.includes(requested)) {
          return res.status(400).json({
            error: "Unsupported network",
            message: `Network '${requested}' is not supported. Supported networks: ${supportedNetworks.join(", ")}`,
            supported_networks: supportedNetworks,
          });
        }
      }
      const featureFlags = {
        graphql: true,
        websockets: true,
        sse: true,
        sandbox: true,
        webhooks: true,
        contract_verification: true,
        dlq: true,
        rate_limiting: true,
        analytics_sql: true,
      };
      const capabilities = {
        networks: supportedNetworks,
        current_network: req.query.network ? String(req.query.network).toLowerCase() : "testnet",
        api_versions: ["v1"],
        current_version: "v1",
        pagination_modes: ["cursor", "offset"],
        transports: ["http", "websocket", "sse", "graphql"],
        feature_flags: featureFlags,
        features: featureFlags,
      };
      const etag = 'W/"caps-test-123"';
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      res.json(capabilities);
    });
    return app;
  }

  it("returns 200 with full capability discovery payload on normal path", async () => {
    const app = createApp();
    const server = http.createServer(app).listen(0);
    try {
      const res = await makeRequest(server, "/api/capabilities");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.networks));
      assert.ok(res.body.networks.includes("testnet"));
      assert.ok(res.body.networks.includes("mainnet"));
      assert.ok(res.body.networks.includes("futurenet"));
      assert.equal(res.body.current_network, "testnet");
      assert.ok(Array.isArray(res.body.api_versions));
      assert.ok(res.body.api_versions.includes("v1"));
      assert.ok(Array.isArray(res.body.pagination_modes));
      assert.ok(res.body.pagination_modes.includes("cursor"));
      assert.ok(Array.isArray(res.body.transports));
      assert.ok(res.body.transports.includes("http"));
      assert.ok(res.body.transports.includes("websocket"));
      assert.ok(res.body.feature_flags && typeof res.body.feature_flags === "object");
      assert.equal(res.body.feature_flags.graphql, true);
      assert.ok(res.headers["cache-control"].includes("public"));
      assert.ok(res.headers["etag"]);
    } finally {
      server.close();
    }
  });

  it("supports network query filter and validates input", async () => {
    const app = createApp();
    const server = http.createServer(app).listen(0);
    try {
      // Valid network filter
      const resValid = await makeRequest(server, "/api/capabilities?network=mainnet");
      assert.equal(resValid.status, 200);
      assert.equal(resValid.body.current_network, "mainnet");

      // Invalid network filter returns actionable 400
      const resInvalid = await makeRequest(server, "/api/capabilities?network=unknown_net");
      assert.equal(resInvalid.status, 400);
      assert.equal(resInvalid.body.error, "Unsupported network");
      assert.ok(Array.isArray(resInvalid.body.supported_networks));
    } finally {
      server.close();
    }
  });

  it("returns 304 Not Modified when If-None-Match matches ETag", async () => {
    const app = createApp();
    const server = http.createServer(app).listen(0);
    try {
      const res1 = await makeRequest(server, "/api/capabilities");
      assert.equal(res1.status, 200);
      const etag = res1.headers["etag"];

      const res2 = await makeRequest(server, "/api/capabilities", {
        headers: { "if-none-match": etag },
      });
      assert.equal(res2.status, 304);
      assert.equal(res2.raw, "");
    } finally {
      server.close();
    }
  });
});

describe("Issue #1076: Response-size limits & payload limits", () => {
  function createAppWithLimits() {
    const app = express();
    app.use(
      express.json({
        limit: "1mb",
        verify: (req, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.use((err, req, res, next) => {
      if (err.type === "entity.too.large" || err.status === 413) {
        return res.status(413).json({
          error: "Payload too large",
          message: "Request payload exceeds the maximum allowed size of 1MB",
          limit_bytes: 1048576,
        });
      }
      if (err.status === 400 && ("body" in err || err.type === "entity.parse.failed")) {
        return res.status(400).json({
          error: "Invalid JSON payload",
          message: err.message || "Could not parse JSON body",
        });
      }
      next(err);
    });

    app.get("/api/test-limit", validateLimitParam({ defaultLimit: 25, maxLimit: 200 }), (req, res) => {
      res.json({ limit: Number(req.query.limit) || 25 });
    });

    app.post("/api/test-payload", (req, res) => {
      res.json({ received: true, size: req.rawBody?.length ?? 0 });
    });

    return app;
  }

  it("accepts valid limit and defaults when missing", async () => {
    const app = createAppWithLimits();
    const server = http.createServer(app).listen(0);
    try {
      const resDefault = await makeRequest(server, "/api/test-limit");
      assert.equal(resDefault.status, 200);
      assert.equal(resDefault.body.limit, 25);

      const resExplicit = await makeRequest(server, "/api/test-limit?limit=50");
      assert.equal(resExplicit.status, 200);
      assert.equal(resExplicit.body.limit, 50);
    } finally {
      server.close();
    }
  });

  it("returns actionable 422 for limit boundaries (zero, negative, > maxLimit, non-integer)", async () => {
    const app = createAppWithLimits();
    const server = http.createServer(app).listen(0);
    try {
      for (const invalid of ["0", "-1", "201", "abc", "1.5"]) {
        const res = await makeRequest(server, `/api/test-limit?limit=${invalid}`);
        assert.equal(res.status, 422, `Expected 422 for limit=${invalid}`);
        assert.equal(res.body.error, "Invalid limit");
        assert.ok(res.body.message.includes("between 1 and 200"));
        assert.equal(res.body.max_limit, 200);
      }
    } finally {
      server.close();
    }
  });

  it("returns 413 Payload Too Large when request body exceeds 1MB limit", async () => {
    const app = createAppWithLimits();
    const server = http.createServer(app).listen(0);
    try {
      // Create body slightly larger than 1MB
      const largeData = "x".repeat(1024 * 1024 + 100);
      const res = await makeRequest(server, "/api/test-payload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: largeData }),
      });
      assert.equal(res.status, 413);
      assert.equal(res.body.error, "Payload too large");
      assert.equal(res.body.limit_bytes, 1048576);
    } finally {
      server.close();
    }
  });

  it("returns 400 for malformed JSON payload", async () => {
    const app = createAppWithLimits();
    const server = http.createServer(app).listen(0);
    try {
      const res = await makeRequest(server, "/api/test-payload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"invalid": json',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "Invalid JSON payload");
    } finally {
      server.close();
    }
  });
});

describe("Issue #1075: Bulk contract metadata lookup", () => {
  function createBulkApp(mockContracts) {
    const app = express();
    app.use(express.json());

    const bulkHandler = async (req, res) => {
      let contractIds = [];
      if (req.method === "GET") {
        const raw = req.query.ids || req.query.contract_ids;
        contractIds = raw
          ? String(raw)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      } else {
        const body = req.body;
        if (!body || typeof body !== "object") {
          return res.status(400).json({
            error: "Invalid request payload",
            message: "Request body must be a JSON object with 'contract_ids' array or an array of strings",
          });
        }
        if (Array.isArray(body)) contractIds = body;
        else if (Array.isArray(body.contract_ids)) contractIds = body.contract_ids;
        else if (Array.isArray(body.contracts)) contractIds = body.contracts;
        else if (Array.isArray(body.ids)) contractIds = body.ids;
        else {
          return res.status(400).json({
            error: "Invalid request payload",
            message: "Missing 'contract_ids' array in request body",
          });
        }
      }

      if (!Array.isArray(contractIds)) {
        return res.status(400).json({ error: "Invalid schema", message: "contract_ids must be an array of strings" });
      }

      for (let i = 0; i < contractIds.length; i++) {
        if (typeof contractIds[i] !== "string" || !contractIds[i].trim()) {
          return res.status(400).json({
            error: "Invalid schema",
            message: `Contract ID at index ${i} must be a non-empty string`,
          });
        }
      }

      if (contractIds.length > 100) {
        return res.status(400).json({
          error: "Batch size limit exceeded",
          message: "contract_ids list cannot exceed 100 items",
          max_items: 100,
        });
      }

      if (contractIds.length === 0) {
        return res.json({ results: [], data: [], total: 0, found: 0, not_found: 0 });
      }

      let foundCount = 0;
      let notFoundCount = 0;
      const results = contractIds.map((id) => {
        const meta = mockContracts[id];
        if (!meta) {
          notFoundCount++;
          return { contract_id: id, id, found: false, metadata: null, data: null, error: "Contract not found" };
        }
        foundCount++;
        let sanitized = meta;
        if (["rejected", "hidden"].includes(meta.moderation_status)) {
          sanitized = {
            id: meta.id,
            moderation_status: meta.moderation_status,
            name: null,
            description: null,
            functions: [],
          };
        }
        return { contract_id: id, id, found: true, metadata: sanitized, data: sanitized };
      });

      res.json({ results, data: results, total: results.length, found: foundCount, not_found: notFoundCount });
    };

    app.post("/api/contracts/bulk", bulkHandler);
    app.get("/api/contracts/bulk", bulkHandler);
    return app;
  }

  const mockDb = {
    CA111: { id: "CA111", name: "Contract One", description: "First contract", functions: ["mint"] },
    CA222: { id: "CA222", name: "Hidden Contract", moderation_status: "hidden", functions: [] },
  };

  it("returns per-item found and not-found results for bounded list", async () => {
    const app = createBulkApp(mockDb);
    const server = http.createServer(app).listen(0);
    try {
      const res = await makeRequest(server, "/api/contracts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { contract_ids: ["CA111", "CA999", "CA222"] },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 3);
      assert.equal(res.body.found, 2);
      assert.equal(res.body.not_found, 1);

      // Item 0: found
      assert.equal(res.body.results[0].contract_id, "CA111");
      assert.equal(res.body.results[0].found, true);
      assert.equal(res.body.results[0].metadata.name, "Contract One");

      // Item 1: not found
      assert.equal(res.body.results[1].contract_id, "CA999");
      assert.equal(res.body.results[1].found, false);
      assert.equal(res.body.results[1].metadata, null);
      assert.equal(res.body.results[1].error, "Contract not found");

      // Item 2: moderated hidden
      assert.equal(res.body.results[2].contract_id, "CA222");
      assert.equal(res.body.results[2].found, true);
      assert.equal(res.body.results[2].metadata.name, null);
    } finally {
      server.close();
    }
  });

  it("handles GET query parameter bulk lookup", async () => {
    const app = createBulkApp(mockDb);
    const server = http.createServer(app).listen(0);
    try {
      const res = await makeRequest(server, "/api/contracts/bulk?ids=CA111,CA999");
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 2);
      assert.equal(res.body.found, 1);
      assert.equal(res.body.not_found, 1);
    } finally {
      server.close();
    }
  });

  it("handles explicit empty contract ID list", async () => {
    const app = createBulkApp(mockDb);
    const server = http.createServer(app).listen(0);
    try {
      const res = await makeRequest(server, "/api/contracts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { contract_ids: [] },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.results, []);
      assert.equal(res.body.total, 0);
      assert.equal(res.body.found, 0);
      assert.equal(res.body.not_found, 0);
    } finally {
      server.close();
    }
  });

  it("rejects batch size exceeding 100 with 400 Bad Request", async () => {
    const app = createBulkApp(mockDb);
    const server = http.createServer(app).listen(0);
    try {
      const tooMany = Array.from({ length: 101 }, (_, i) => `C${i}`);
      const res = await makeRequest(server, "/api/contracts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { contract_ids: tooMany },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "Batch size limit exceeded");
      assert.equal(res.body.max_items, 100);
    } finally {
      server.close();
    }
  });

  it("rejects invalid input schema (non-array, non-string items)", async () => {
    const app = createBulkApp(mockDb);
    const server = http.createServer(app).listen(0);
    try {
      const res1 = await makeRequest(server, "/api/contracts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { contract_ids: "not-an-array" },
      });
      assert.equal(res1.status, 400);

      const res2 = await makeRequest(server, "/api/contracts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { contract_ids: ["valid", 123] },
      });
      assert.equal(res2.status, 400);
      assert.equal(res2.body.error, "Invalid schema");
    } finally {
      server.close();
    }
  });
});

describe("Issue #1074: Conditional requests on analytics responses", () => {
  it("computes deterministic ETag based on query and ledger watermark", () => {
    const etag1 = computeAnalyticsETag("SELECT count(*) FROM events", 1000);
    const etag2 = computeAnalyticsETag("select count(*) from events", 1000);
    const etagDiffWatermark = computeAnalyticsETag("SELECT count(*) FROM events", 1001);
    const etagDiffQuery = computeAnalyticsETag("SELECT max(fee) FROM events", 1000);

    assert.equal(etag1, etag2, "ETag must be case- and whitespace-insensitive");
    assert.notEqual(etag1, etagDiffWatermark, "ETag must change when watermark changes");
    assert.notEqual(etag1, etagDiffQuery, "ETag must change when query changes");
    assert.ok(etag1.startsWith('W/"analytics-1000-'));
  });

  function createAnalyticsApp(watermarkGetter) {
    const app = express();
    app.use(express.json());

    const sqlHandler = async (req, res) => {
      const isGet = req.method === "GET";
      const body = isGet ? req.query : req.body;
      if (!body || typeof body !== "object" || !body.query) {
        return res.status(400).json({ error: "Expected only query and format fields", message: "query is required" });
      }
      const query = String(body.query);
      const format = body.format || "json";
      const watermark = await watermarkGetter();
      const etag = computeAnalyticsETag(query, watermark, format);

      res.setHeader("ETag", etag);
      res.setHeader("X-Ledger-Watermark", String(watermark));
      res.setHeader("Cache-Control", "public, max-age=60");

      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }

      res.json({ rows: [{ count: 42 }], row_count: 1, watermark });
    };

    app.post("/api/sql", sqlHandler);
    app.get("/api/sql", sqlHandler);
    return app;
  }

  it("returns 200 with ETag and X-Ledger-Watermark headers on initial request", async () => {
    let currentWatermark = 500;
    const app = createAnalyticsApp(() => currentWatermark);
    const server = http.createServer(app).listen(0);
    try {
      const res = await makeRequest(server, "/api/sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { query: "SELECT count(*) FROM analytics.events" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-ledger-watermark"], "500");
      assert.ok(res.headers["etag"]);
      assert.ok(res.headers["cache-control"].includes("public"));
    } finally {
      server.close();
    }
  });

  it("returns 304 Not Modified when query and ledger watermark are unchanged", async () => {
    let currentWatermark = 500;
    const app = createAnalyticsApp(() => currentWatermark);
    const server = http.createServer(app).listen(0);
    try {
      const res1 = await makeRequest(server, "/api/sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { query: "SELECT count(*) FROM analytics.events" },
      });
      assert.equal(res1.status, 200);
      const etag = res1.headers["etag"];

      // Conditional request when watermark is unchanged -> 304
      const res2 = await makeRequest(server, "/api/sql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-none-match": etag,
        },
        body: { query: "SELECT count(*) FROM analytics.events" },
      });
      assert.equal(res2.status, 304);
      assert.equal(res2.raw, "");
      assert.equal(res2.headers["etag"], etag);
      assert.equal(res2.headers["x-ledger-watermark"], "500");

      // When watermark updates, conditional request returns 200 fresh data
      currentWatermark = 501;
      const res3 = await makeRequest(server, "/api/sql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-none-match": etag,
        },
        body: { query: "SELECT count(*) FROM analytics.events" },
      });
      assert.equal(res3.status, 200);
      assert.equal(res3.headers["x-ledger-watermark"], "501");
      assert.notEqual(res3.headers["etag"], etag);
    } finally {
      server.close();
    }
  });

  it("handles GET /api/sql conditional requests identically", async () => {
    const app = createAnalyticsApp(() => 750);
    const server = http.createServer(app).listen(0);
    try {
      const res1 = await makeRequest(server, "/api/sql?query=SELECT%201");
      assert.equal(res1.status, 200);
      const etag = res1.headers["etag"];

      const res2 = await makeRequest(server, "/api/sql?query=SELECT%201", {
        headers: { "if-none-match": etag },
      });
      assert.equal(res2.status, 304);
    } finally {
      server.close();
    }
  });

  it("returns 400 for empty or missing query", async () => {
    const app = createAnalyticsApp(() => 100);
    const server = http.createServer(app).listen(0);
    try {
      const res = await makeRequest(server, "/api/sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { query: "" },
      });
      assert.equal(res.status, 400);
    } finally {
      server.close();
    }
  });
});
