import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import {
  ALERT_CONDITIONS,
  checkDbPoolSaturation,
  getActiveAlerts,
  fireAlert,
  resolveAlert,
} from "../src/alertManager.js";

import {
  getRouteFamily,
  recordRequestLatency,
  getLatencyDistributions,
  clearLatencySamplesForTest,
  recordUpstreamLatency,
  ROUTE_FAMILIES,
} from "../src/latencyDistribution.js";

import {
  recordIncident,
  getIncidentTimeline,
  clearIncidentsForTest,
  VALID_EVENT_TYPES,
  VALID_SEVERITIES,
} from "../src/incidentTimeline.js";

import {
  getHealthStatus,
  getReadinessStatus,
  getLivenessStatus,
  checkRpc,
  setRpcStatusOverride,
  setDbStatusOverride,
  setDraining,
} from "../src/health.js";

import {
  getPoolStats,
  resetPoolStats,
  recordPoolAcquire,
  db,
} from "../src/db.js";

import {
  dbPoolSaturation,
  dbPoolWaitDuration,
  apiRouteFamilyDuration,
  updateDbPoolMetrics,
} from "../src/metrics.js";

// ── Test App Setup ────────────────────────────────────────────────────────────

function createTestObservabilityApp() {
  const app = express();
  app.use(express.json());

  // Latency middleware simulation
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const totalMs = Date.now() - start + (req.simulatedLatencyMs || 5);
      const upstreamMs = req.simulatedUpstreamMs || 0;
      const family = getRouteFamily(req.path);
      recordRequestLatency({
        routeFamily: family,
        method: req.method,
        status: String(res.statusCode),
        totalMs,
        upstreamMs,
      });
    });
    next();
  });

  // Endpoints under test
  app.get("/health/live", (_req, res) => {
    res.json(getLivenessStatus());
  });

  const readinessHandler = async (req, res) => {
    try {
      const dependency = req.params?.dependency || req.query?.dependency;
      const readiness = await getReadinessStatus({ dependency });
      if (readiness.valid === false) {
        return res.status(readiness.statusCode || 400).json({ error: readiness.error });
      }
      const statusCode = readiness.status === "ready" ? 200 : 503;
      res.status(statusCode).json(readiness);
    } catch (e) {
      res.status(503).json({
        status: "not_ready",
        error: e.message,
        timestamp: new Date().toISOString(),
      });
    }
  };

  app.get("/health/ready", readinessHandler);
  app.get("/health/ready/:dependency", readinessHandler);

  app.get("/api/observability/latency", (req, res) => {
    try {
      const { route_family } = req.query;
      const result = getLatencyDistributions({ route_family });
      res.json(result);
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  app.get("/api/operator/incidents", async (req, res) => {
    try {
      const { event_type, severity, source, from, to, limit, offset } = req.query;
      const result = await getIncidentTimeline({ event_type, severity, source, from, to, limit, offset });
      res.json(result);
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  app.post("/api/operator/incidents", async (req, res) => {
    try {
      const result = await recordIncident(req.body);
      res.status(201).json(result);
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  });

  app.get("/api/db/pool", (_req, res) => {
    res.json(getPoolStats());
  });

  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Issue #1116: DB Connection-Pool Saturation Alerts", () => {
  beforeEach(() => {
    resetPoolStats();
    resolveAlert(ALERT_CONDITIONS.DB_POOL_SATURATION);
  });

  it("exports DB_POOL_SATURATION in ALERT_CONDITIONS", () => {
    assert.ok(ALERT_CONDITIONS.DB_POOL_SATURATION);
    assert.equal(ALERT_CONDITIONS.DB_POOL_SATURATION, "DB_POOL_SATURATION");
  });

  it("tracks pool wait times and calculates pool statistics", () => {
    recordPoolAcquire(15);
    recordPoolAcquire(25);
    recordPoolAcquire(50);

    const stats = getPoolStats();
    assert.equal(typeof stats.total, "number");
    assert.equal(typeof stats.idle, "number");
    assert.equal(typeof stats.waiting, "number");
    assert.equal(typeof stats.saturation, "number");
    assert.equal(stats.avgWaitTimeMs, 30);
    assert.equal(stats.maxWaitTimeMs, 50);
  });

  it("fires alert when saturation ratio exceeds threshold", async () => {
    await checkDbPoolSaturation({ saturation: 0.90, avgWaitTimeMs: 10, waitingCount: 0 });
    const active = getActiveAlerts();
    const alert = active.find((a) => a.condition === ALERT_CONDITIONS.DB_POOL_SATURATION);
    assert.ok(alert, "DB_POOL_SATURATION alert should be active");
  });

  it("fires alert when pool wait time exceeds threshold", async () => {
    await checkDbPoolSaturation({ saturation: 0.50, avgWaitTimeMs: 1200, waitingCount: 0 });
    const active = getActiveAlerts();
    const alert = active.find((a) => a.condition === ALERT_CONDITIONS.DB_POOL_SATURATION);
    assert.ok(alert, "DB_POOL_SATURATION alert should fire on wait time");
  });

  it("fires alert when clients are queued waiting for connections", async () => {
    await checkDbPoolSaturation({ saturation: 0.60, avgWaitTimeMs: 50, waitingCount: 2 });
    const active = getActiveAlerts();
    const alert = active.find((a) => a.condition === ALERT_CONDITIONS.DB_POOL_SATURATION);
    assert.ok(alert, "DB_POOL_SATURATION alert should fire on waiting clients");
  });

  it("resolves alert when metrics return to normal", async () => {
    await fireAlert(ALERT_CONDITIONS.DB_POOL_SATURATION, "pool saturated");
    await checkDbPoolSaturation({ saturation: 0.30, avgWaitTimeMs: 10, waitingCount: 0 });
    const active = getActiveAlerts();
    assert.ok(!active.some((a) => a.condition === ALERT_CONDITIONS.DB_POOL_SATURATION));
  });

  it("updates Prometheus pool saturation gauge", () => {
    updateDbPoolMetrics({ totalCount: 10, idleCount: 2, waitingCount: 1, options: { max: 10 } }, { saturation: 0.8 });
    // gauge does not throw
  });

  it("GET /api/db/pool returns pool stats", async () => {
    const app = createTestObservabilityApp();
    const res = await request(app).get("/api/db/pool");
    assert.equal(res.status, 200);
    assert.ok(res.body.total !== undefined);
    assert.ok(res.body.saturation !== undefined);
    assert.ok(res.body.avgWaitTimeMs !== undefined);
  });
});

describe("Issue #1115: Operator Incident Timeline", () => {
  beforeEach(() => {
    clearIncidentsForTest();
  });

  it("records valid deployment incident event", async () => {
    const event = await recordIncident({
      event_type: "deployment",
      severity: "info",
      source: "indexer",
      summary: "Deployed release v1.4.0",
      details: { version: "v1.4.0", commit: "abcdef" },
    });

    assert.equal(event.event_type, "deployment");
    assert.equal(event.severity, "info");
    assert.equal(event.summary, "Deployed release v1.4.0");
    assert.ok(event.created_at);
  });

  it("records provider_change and recovery_action events", async () => {
    await recordIncident({
      event_type: "provider_change",
      severity: "warning",
      source: "rpc",
      summary: "RPC primary failed over to secondary node",
      details: { previous: "https://rpc1.org", current: "https://rpc2.org" },
    });

    await recordIncident({
      event_type: "recovery_action",
      severity: "info",
      source: "rpc",
      summary: "RPC primary node recovered",
      details: { node: "https://rpc1.org" },
    });

    const timeline = await getIncidentTimeline();
    assert.equal(timeline.total, 2);
    assert.equal(timeline.data.length, 2);
  });

  it("rejects invalid event_type with 400 Bad Request", async () => {
    await assert.rejects(
      () => recordIncident({
        event_type: "unsupported_type",
        summary: "test",
      }),
      (err) => err.statusCode === 400 && err.message.includes("Invalid 'event_type'"),
    );
  });

  it("rejects empty summary with 400 Bad Request", async () => {
    await assert.rejects(
      () => recordIncident({
        event_type: "lag_spike",
        summary: "   ",
      }),
      (err) => err.statusCode === 400,
    );
  });

  it("filters timeline by event_type and severity via API", async () => {
    const app = createTestObservabilityApp();

    await request(app).post("/api/operator/incidents").send({
      event_type: "lag_spike",
      severity: "critical",
      summary: "Lag exceeded 500 ledgers",
      details: { lagSeconds: 600 },
    });

    await request(app).post("/api/operator/incidents").send({
      event_type: "deployment",
      severity: "info",
      summary: "Config reloaded",
    });

    // Query filter by type
    const resLag = await request(app).get("/api/operator/incidents?event_type=lag_spike");
    assert.equal(resLag.status, 200);
    assert.equal(resLag.body.total, 1);
    assert.equal(resLag.body.data[0].event_type, "lag_spike");

    // Query filter by severity
    const resCrit = await request(app).get("/api/operator/incidents?severity=critical");
    assert.equal(resCrit.status, 200);
    assert.equal(resCrit.body.total, 1);
    assert.equal(resCrit.body.data[0].severity, "critical");

    // Empty result when filter does not match
    const resEmpty = await request(app).get("/api/operator/incidents?event_type=alert_trigger");
    assert.equal(resEmpty.status, 200);
    assert.equal(resEmpty.body.total, 0);
    assert.deepEqual(resEmpty.body.data, []);
  });

  it("POST /api/operator/incidents validates payload", async () => {
    const app = createTestObservabilityApp();

    const badRes = await request(app).post("/api/operator/incidents").send({});
    assert.equal(badRes.status, 400);
    assert.ok(badRes.body.error);
  });
});

describe("Issue #1117: Per-Endpoint API Latency Distributions", () => {
  beforeEach(() => {
    clearLatencySamplesForTest();
  });

  it("maps paths to low-cardinality route families", () => {
    assert.equal(getRouteFamily("/api/events?limit=50"), "events");
    assert.equal(getRouteFamily("/api/events/12345"), "events");
    assert.equal(getRouteFamily("/api/contracts/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"), "contracts");
    assert.equal(getRouteFamily("/api/tokens/CDLZFC/metadata"), "tokens");
    assert.equal(getRouteFamily("/api/transactions/abc123hash"), "transactions");
    assert.equal(getRouteFamily("/api/wallets/GBABCDEF/history"), "wallets");
    assert.equal(getRouteFamily("/api/rpc"), "rpc");
    assert.equal(getRouteFamily("/health/ready"), "health");
    assert.equal(getRouteFamily("/api/health"), "health");
    assert.equal(getRouteFamily("/api/observability/latency"), "system");
    assert.equal(getRouteFamily("/api/unknown/something"), "other");
  });

  it("records server vs upstream latency distributions and calculates percentiles", () => {
    recordRequestLatency({
      routeFamily: "events",
      method: "GET",
      status: "200",
      totalMs: 100,
      upstreamMs: 80,
    });
    recordRequestLatency({
      routeFamily: "events",
      method: "GET",
      status: "200",
      totalMs: 60,
      upstreamMs: 40,
    });

    const dist = getLatencyDistributions({ route_family: "events" });
    assert.equal(dist.route_family, "events");
    assert.equal(dist.count, 2);

    // Server latency = total - upstream
    // 100 - 80 = 20ms, 60 - 40 = 20ms -> avg = 20ms
    assert.equal(dist.server.avgMs, 20);
    assert.equal(dist.server.minMs, 20);
    assert.equal(dist.server.maxMs, 20);

    // Upstream latency = 80ms, 40ms -> avg = 60ms
    assert.equal(dist.upstream.avgMs, 60);
    assert.equal(dist.upstream.minMs, 40);
    assert.equal(dist.upstream.maxMs, 80);

    // Total latency = 100ms, 60ms -> avg = 80ms
    assert.equal(dist.total.avgMs, 80);
    assert.equal(dist.total.minMs, 60);
    assert.equal(dist.total.maxMs, 100);
  });

  it("GET /api/observability/latency returns all route families by default", async () => {
    const app = createTestObservabilityApp();
    const res = await request(app).get("/api/observability/latency");

    assert.equal(res.status, 200);
    assert.ok(res.body.timestamp);
    assert.ok(res.body.route_families);
    assert.ok(res.body.route_families.events);
    assert.ok(res.body.route_families.contracts);
    assert.ok(res.body.route_families.rpc);
    assert.ok(res.body.route_families.health);
  });

  it("GET /api/observability/latency returns 400 for invalid route_family", async () => {
    const app = createTestObservabilityApp();
    const res = await request(app).get("/api/observability/latency?route_family=invalid_family");

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
    assert.ok(res.body.error.includes("Invalid route_family"));
  });

  it("handles empty distributions gracefully with count: 0 and null percentiles", () => {
    const dist = getLatencyDistributions({ route_family: "contracts" });
    assert.equal(dist.count, 0);
    assert.equal(dist.server.count, 0);
    assert.equal(dist.server.avgMs, null);
    assert.equal(dist.upstream.avgMs, null);
  });
});

describe("Issue #1119: Operational Readiness Checks for Dependencies", () => {
  beforeEach(() => {
    setRpcStatusOverride(null);
    setDbStatusOverride({
      status: "healthy",
      ready: true,
      responseTime: 3,
      connections: { total: 10, idle: 8, active: 2, waiting: 0, max: 10, saturation: 0.2, avgWaitTimeMs: 10, maxWaitTimeMs: 20 },
    });
    setDraining(false);
  });

  it("reports database, cache, and RPC readiness separately in getReadinessStatus", async () => {
    setRpcStatusOverride({
      status: "healthy",
      ready: true,
      responseTime: 10,
      totalNodes: 2,
      healthyNodes: 2,
      nodes: [{ url: "https://node1.org", healthy: true }],
    });

    const readiness = await getReadinessStatus();
    assert.equal(readiness.status, "ready");
    assert.equal(readiness.ready, true);
    assert.ok(readiness.dependencies.database);
    assert.ok(readiness.dependencies.cache);
    assert.ok(readiness.dependencies.rpc);
    assert.equal(readiness.dependencies.rpc.ready, true);
  });

  it("reports not_ready when RPC dependency is unhealthy", async () => {
    setRpcStatusOverride({
      status: "unhealthy",
      ready: false,
      error: "All RPC nodes unavailable",
      responseTime: 50,
      totalNodes: 2,
      healthyNodes: 0,
      nodes: [],
    });

    const readiness = await getReadinessStatus();
    assert.equal(readiness.status, "not_ready");
    assert.equal(readiness.ready, false);
    assert.equal(readiness.dependencies.rpc.ready, false);
    assert.ok(readiness.reason.includes("rpc"));
  });

  it("reports not_ready when DB dependency is unhealthy", async () => {
    setDbStatusOverride({
      status: "unhealthy",
      ready: false,
      error: "Connection refused",
      responseTime: 10,
    });
    setRpcStatusOverride({
      status: "healthy",
      ready: true,
      responseTime: 5,
      totalNodes: 1,
      healthyNodes: 1,
    });

    const readiness = await getReadinessStatus();
    assert.equal(readiness.status, "not_ready");
    assert.equal(readiness.ready, false);
    assert.equal(readiness.dependencies.database.ready, false);
    assert.ok(readiness.reason.includes("database"));
  });

  it("checks individual dependency readiness via ?dependency= parameter", async () => {
    setRpcStatusOverride({
      status: "healthy",
      ready: true,
      responseTime: 12,
      totalNodes: 1,
      healthyNodes: 1,
    });

    const app = createTestObservabilityApp();

    const rpcRes = await request(app).get("/health/ready?dependency=rpc");
    assert.equal(rpcRes.status, 200);
    assert.equal(rpcRes.body.dependency, "rpc");
    assert.equal(rpcRes.body.status, "ready");
    assert.equal(rpcRes.body.ready, true);
    assert.ok(rpcRes.body.details);

    const dbRes = await request(app).get("/health/ready?dependency=database");
    assert.equal(dbRes.status, 200);
    assert.equal(dbRes.body.dependency, "database");
    assert.equal(dbRes.body.status, "ready");
  });

  it("returns 400 Bad Request when unknown dependency is queried", async () => {
    const app = createTestObservabilityApp();
    const res = await request(app).get("/health/ready?dependency=invalid_dep");

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
    assert.ok(res.body.error.includes("Invalid dependency"));
  });

  it("reports not_ready with 503 when draining for graceful shutdown", async () => {
    setDraining(true);
    const app = createTestObservabilityApp();
    const res = await request(app).get("/health/ready");

    assert.equal(res.status, 503);
    assert.equal(res.body.status, "not_ready");
    assert.equal(res.body.ready, false);
    assert.equal(res.body.reason, "Draining for shutdown");
  });

  it("liveness check remains distinct from readiness and returns alive", async () => {
    // Even if draining, liveness should stay alive
    setDraining(true);
    const app = createTestObservabilityApp();
    const res = await request(app).get("/health/live");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "alive");
    assert.ok(res.body.timestamp);
  });
});
