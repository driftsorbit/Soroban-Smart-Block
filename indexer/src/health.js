/**
 * Comprehensive Health Check Module
 *
 * Separates liveness from readiness and tracks individual dependency health:
 * - Database (PostgreSQL)
 * - Cache (Redis L2)
 * - Indexer (ledger sync status)
 * - Workers (background jobs)
 *
 * Liveness: Service is running and should not be restarted
 * Readiness: Service can handle traffic (dependencies healthy)
 */

import { db, pool } from "./db.js";
import * as alertManager from "./alertManager.js";
import { getRpcNodeStatus } from "./rpcMultiNode.js";

const { getActiveAlerts } = alertManager;

let _rpcStatusOverride = null;
let _dbStatusOverride = null;

/**
 * Override RPC node status for unit testing without live network dependencies.
 * @param {object|null} override
 */
export function setRpcStatusOverride(override) {
  _rpcStatusOverride = override;
}

/**
 * Override DB status for unit testing without live network dependencies.
 * @param {object|null} override
 */
export function setDbStatusOverride(override) {
  _dbStatusOverride = override;
}

// ── Configurable thresholds ───────────────────────────────────────────────────
// INDEXER_LAG_THRESHOLD_SECONDS: Threshold above which indexer is marked unhealthy
// Default: 120 seconds (2 minutes). When sync lag exceeds this, indexer status
// becomes "unhealthy", which downgrades overall health and readiness status.
const INDEXER_LAG_THRESHOLD_SECONDS =
  Number.parseInt(process.env.INDEXER_LAG_THRESHOLD_SECONDS ?? "120", 10) || 120;

// ── Health check state ────────────────────────────────────────────────────────
let _indexerStatus = { healthy: true, lastLedger: 0, lastSync: Date.now(), lagSeconds: 0, ledgerLag: 0 };
let _workerStatus = { healthy: true, errors: 0, lastRun: Date.now() };
let _dlqDepth = 0;

// ── Indexer stats (for the frontend's home-page stats bar) ────────────────
// COUNT(*) over `events` and `dead_letter_queue` on every /api/health poll
// (every 10s per client, and there may be several clients) would add
// avoidable load, so these are memoized for a few seconds.
let _statsCache = null;
let _statsCacheAt = 0;
const STATS_CACHE_MS = 5000;

async function getIndexerStats() {
  const now = Date.now();
  if (_statsCache && now - _statsCacheAt < STATS_CACHE_MS) return _statsCache;

  const [totalRes, recentRes, dlqRes] = await Promise.all([
    db.query("SELECT COUNT(*)::INT AS total FROM events"),
    db.query("SELECT COUNT(*)::INT AS recent FROM events WHERE created_at > NOW() - INTERVAL '5 minutes'"),
    db.query("SELECT COUNT(*)::INT AS failed FROM dead_letter_queue WHERE resolved = FALSE"),
  ]);

  const totalEvents = totalRes.rows[0]?.total ?? 0;
  const recentEvents = recentRes.rows[0]?.recent ?? 0;
  const failedDecodes = dlqRes.rows[0]?.failed ?? 0;
  const decodeAttempts = totalEvents + failedDecodes;

  _statsCache = {
    total_events: totalEvents,
    events_per_minute: Math.round((recentEvents / 5) * 10) / 10,
    decode_success_rate: decodeAttempts > 0 ? Math.round((totalEvents / decodeAttempts) * 10000) / 100 : 100,
  };
  _statsCacheAt = now;
  return _statsCache;
}

// Global Redis client reference (set by cacheLayer or health check)
let _redisClient = null;

/**
 * Set the Redis client for health checks
 * Called from cacheLayer.js or similar module during initialization
 */
export function setRedisClient(client) {
  _redisClient = client;
}

/**
 * Update indexer health status (called from main daemon)
 */
export function updateIndexerStatus(ledger, lagSeconds, ledgerLag = 0) {
  const normalizedLag = Number.isFinite(Number(lagSeconds)) ? Number(lagSeconds) : 0;
  const normalizedLedgerLag = Number.isFinite(Number(ledgerLag)) ? Number(ledgerLag) : 0;
  _indexerStatus = {
    healthy: normalizedLag < INDEXER_LAG_THRESHOLD_SECONDS,
    lastLedger: ledger,
    lastSync: Date.now(),
    lagSeconds: normalizedLag,
    ledgerLag: normalizedLedgerLag,
  };
}

/**
 * Snapshot of the last-reported indexer status. Used by the partial-data
 * warning builder (#1079) to tell whether the indexer is behind the network.
 * Returns a copy so callers cannot mutate the internal state.
 */
export function getIndexerStatus() {
  return { ..._indexerStatus };
}

/**
 * Update worker health status (called from worker jobs)
 */
export function updateWorkerStatus(errorCount = 0) {
  _workerStatus = {
    healthy: errorCount < 10, // unhealthy if >10 errors
    errors: errorCount,
    lastRun: Date.now(),
  };
}

/**
 * Update the dead-letter-queue depth reported on GET /api/health.
 * Called every 60s from the indexer daemon's periodic health loop, alongside
 * the dlq_depth Prometheus gauge and alertManager.checkDlqSize().
 */
export function updateDlqDepth(depth) {
  _dlqDepth = depth;
}

/**
 * Report worker error (increment error counter)
 */
export function reportWorkerError() {
  _workerStatus.errors = (_workerStatus.errors || 0) + 1;
  _workerStatus.healthy = _workerStatus.errors < 10;
  _workerStatus.lastRun = Date.now();
}

/**
 * Check database health
 * Tests connection and response time
 */
async function checkDatabase() {
  if (_dbStatusOverride !== null) {
    return { ..._dbStatusOverride };
  }
  const start = Date.now();
  try {
    await db.query("SELECT 1 AS health_check");
    const responseTime = Date.now() - start;

    // Get pool stats
    const totalCount = pool?.totalCount || 0;
    const idleCount = pool?.idleCount || 0;
    const waitingCount = pool?.waitingCount || 0;
    const maxCount = pool?.options?.max || 10;
    const activeCount = Math.max(0, totalCount - idleCount);

    const statsFromDb = typeof db?.getPoolStats === "function" ? db.getPoolStats() : null;
    const saturation = statsFromDb?.saturation ?? (maxCount > 0 ? Number((activeCount / maxCount).toFixed(4)) : 0);
    const avgWaitTimeMs = statsFromDb?.avgWaitTimeMs ?? 0;
    const maxWaitTimeMs = statsFromDb?.maxWaitTimeMs ?? 0;

    const poolStats = {
      total: totalCount,
      idle: idleCount,
      active: activeCount,
      waiting: waitingCount,
      max: maxCount,
      saturation,
      avgWaitTimeMs,
      maxWaitTimeMs,
    };

    // Alert proactively if pool is saturated
    if (typeof alertManager?.checkDbPoolSaturation === "function") {
      await alertManager.checkDbPoolSaturation(poolStats);
    }
    
    return {
      status: "healthy",
      ready: true,
      responseTime,
      connections: poolStats,
    };
  } catch (err) {
    return {
      status: "unhealthy",
      ready: false,
      error: err.message,
      responseTime: Date.now() - start,
    };
  }
}

/**
 * Check Redis cache health
 * Tests connection and response time
 */
async function checkCache() {
  if (!_redisClient) {
    return { status: "disabled", ready: true, optional: true, message: "Redis not configured" };
  }

  const start = Date.now();
  try {
    // Check if client is connected
    if (!_redisClient.isOpen) {
      return {
        status: "unhealthy",
        ready: false,
        optional: false,
        error: "Redis client not connected",
        responseTime: Date.now() - start,
      };
    }

    // Ping Redis
    await _redisClient.ping();
    const responseTime = Date.now() - start;
    
    // Get info if available
    let info = {};
    try {
      const infoStr = await _redisClient.info("stats");
      const lines = infoStr.split("\r\n");
      for (const line of lines) {
        if (line.includes("total_connections_received")) {
          const [, value] = line.split(":");
          info.totalConnections = parseInt(value, 10);
        }
        if (line.includes("instantaneous_ops_per_sec")) {
          const [, value] = line.split(":");
          info.opsPerSec = parseInt(value, 10);
        }
      }
    } catch {
      // Info not critical
    }

    return {
      status: "healthy",
      ready: true,
      optional: false,
      responseTime,
      ...info,
    };
  } catch (err) {
    return {
      status: "unhealthy",
      ready: false,
      optional: false,
      error: err.message,
      responseTime: Date.now() - start,
    };
  }
}

/**
 * Check Soroban RPC dependency readiness
 * Reports node status, response times, and healthy provider counts
 */
export async function checkRpc() {
  if (_rpcStatusOverride !== null) {
    return { ..._rpcStatusOverride };
  }

  const start = Date.now();
  try {
    let nodes = [];
    try {
      nodes = typeof getRpcNodeStatus === "function" ? getRpcNodeStatus() : [];
    } catch {
      nodes = [];
    }

    const healthyNodes = nodes.filter((n) => n.healthy);
    const isReady = nodes.length === 0 ? true : healthyNodes.length > 0;

    return {
      status: isReady ? "healthy" : "unhealthy",
      ready: isReady,
      responseTime: Date.now() - start,
      totalNodes: nodes.length,
      healthyNodes: healthyNodes.length,
      primary: nodes[0]?.url ?? null,
      nodes: nodes.map(({ url, healthy, latestLedger }) => ({ url, healthy, latestLedger })),
    };
  } catch (err) {
    return {
      status: "unhealthy",
      ready: false,
      error: err.message,
      responseTime: Date.now() - start,
      totalNodes: 0,
      healthyNodes: 0,
    };
  }
}

/**
 * Check indexer health
 * Reports ledger sync status and lag
 */
function checkIndexer() {
  const timeSinceLastSync = Date.now() - _indexerStatus.lastSync;
  const stale = timeSinceLastSync > 30_000; // no sync in 30s = stale

  return {
    status: _indexerStatus.healthy && !stale ? "healthy" : "unhealthy",
    lastLedger: _indexerStatus.lastLedger,
    lagSeconds: _indexerStatus.lagSeconds,
    ledgerLag: _indexerStatus.ledgerLag,
    lastSyncAgo: Math.floor(timeSinceLastSync / 1000),
  };
}

/**
 * Check worker health
 * Reports background job status
 */
function checkWorkers() {
  const timeSinceLastRun = Date.now() - _workerStatus.lastRun;
  const stale = timeSinceLastRun > 300_000; // no run in 5 minutes = stale

  return {
    status: _workerStatus.healthy && !stale ? "healthy" : "degraded",
    errors: _workerStatus.errors,
    lastRunAgo: Math.floor(timeSinceLastRun / 1000),
  };
}

/**
 * Comprehensive health check
 * Returns detailed status for all dependencies
 */
export async function getHealthStatus() {
  const [database, cache, rpc, stats] = await Promise.all([
    checkDatabase(),
    checkCache(),
    checkRpc(),
    getIndexerStats().catch(() => ({ total_events: null, events_per_minute: null, decode_success_rate: null })),
  ]);

  const indexer = checkIndexer();
  const workers = checkWorkers();
  const activeAlerts = getActiveAlerts();
  const replicas = db.getReplicaState?.() ?? [];

  // Overall status: healthy if all critical dependencies are healthy
  // Cache is optional, workers are degradable
  const criticalHealthy = database.status === "healthy" && indexer.status === "healthy" && (rpc.status === "healthy" || rpc.ready === true);
  const allHealthy = criticalHealthy &&
    (cache.status === "healthy" || cache.status === "disabled") &&
    workers.status === "healthy";

  return {
    status: allHealthy ? "healthy" : criticalHealthy ? "degraded" : "unhealthy",
    timestamp: new Date().toISOString(),
    dependencies: {
      database,
      cache,
      rpc,
      indexer,
      workers,
      replicas: { configured: replicas.length, healthy: replicas.filter((replica) => replica.healthy).length, instances: replicas },
    },
    // Powers the frontend's compact home-page stats bar (polled every 10s).
    stats: {
      total_events: stats.total_events,
      events_per_minute: stats.events_per_minute,
      indexer_lag_ledgers: indexer.ledgerLag,
      decode_success_rate: stats.decode_success_rate,
    },
    alerts: {
      active_count: activeAlerts.length,
      conditions: activeAlerts.map(({ condition }) => condition),
    },
    dlq: {
      depth: _dlqDepth,
    },
  };
}

/**
 * Liveness check
 * Returns 200 if service is running (should not be restarted)
 */
export function getLivenessStatus() {
  return {
    status: "alive",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Readiness check
 * Returns 200 if service can handle traffic (dependencies healthy)
 */
let draining = false;

/**
 * Mark the process as draining (SIGTERM received) so readiness fails and the
 * load balancer stops routing new requests before the server closes (#935).
 */
export function setDraining(value = true) {
  draining = value;
}

export async function getReadinessStatus(options = {}) {
  const dependencyParam = typeof options === "string" ? options : options?.dependency;

  if (dependencyParam) {
    const validDeps = ["database", "cache", "rpc"];
    const normalized = String(dependencyParam).toLowerCase().trim();
    if (!validDeps.includes(normalized)) {
      return {
        valid: false,
        statusCode: 400,
        error: `Invalid dependency: '${dependencyParam}'. Supported dependencies: ${validDeps.join(", ")}`,
      };
    }

    if (draining) {
      return {
        status: "not_ready",
        ready: false,
        timestamp: new Date().toISOString(),
        dependency: normalized,
        reason: "Draining for shutdown",
        details: {},
      };
    }

    let depResult;
    if (normalized === "database") depResult = await checkDatabase();
    else if (normalized === "cache") depResult = await checkCache();
    else if (normalized === "rpc") depResult = await checkRpc();

    const isReady = depResult.ready !== false && depResult.status !== "unhealthy";
    return {
      status: isReady ? "ready" : "not_ready",
      ready: isReady,
      timestamp: new Date().toISOString(),
      dependency: normalized,
      reason: isReady ? null : (depResult.error || `${normalized} is not ready`),
      details: depResult,
    };
  }

  if (draining) {
    return { status: "not_ready", ready: false, timestamp: new Date().toISOString(), reason: "Draining for shutdown", dependencies: {} };
  }

  const [database, cache, rpc] = await Promise.all([
    checkDatabase(),
    checkCache(),
    checkRpc(),
  ]);

  const indexer = checkIndexer();
  const dbReady = database.ready !== false && database.status === "healthy";
  const cacheReady = cache.ready !== false && cache.status !== "unhealthy";
  const rpcReady = rpc.ready !== false && rpc.status !== "unhealthy";
  const indexerReady = indexer.status === "healthy";

  const isReady = dbReady && cacheReady && rpcReady && indexerReady;

  const unreadyReasons = [];
  if (!dbReady) unreadyReasons.push("database unhealthy");
  if (!cacheReady) unreadyReasons.push("cache unhealthy");
  if (!rpcReady) unreadyReasons.push("rpc unhealthy");
  if (!indexerReady) unreadyReasons.push("indexer sync lag unhealthy");

  return {
    status: isReady ? "ready" : "not_ready",
    ready: isReady,
    timestamp: new Date().toISOString(),
    reason: isReady ? null : `Critical dependencies unhealthy: ${unreadyReasons.join(", ")}`,
    dependencies: {
      database,
      cache,
      rpc,
      indexer,
    },
  };
}
