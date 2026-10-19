import { requestContext } from "./logger.js";
import { apiRouteFamilyDuration } from "./metrics.js";

/**
 * Low-cardinality route families
 */
export const ROUTE_FAMILIES = Object.freeze([
  "events",
  "contracts",
  "tokens",
  "transactions",
  "wallets",
  "rpc",
  "health",
  "system",
  "admin",
  "webhooks",
  "other",
]);

/**
 * Map request path to a low-cardinality route family
 * @param {string} path
 * @returns {string} One of ROUTE_FAMILIES
 */
export function getRouteFamily(path) {
  if (!path || typeof path !== "string") return "other";
  const clean = path.split("?")[0].toLowerCase().trim();

  if (clean.startsWith("/health") || clean.startsWith("/api/health")) return "health";
  if (clean.startsWith("/api/events")) return "events";
  if (clean.startsWith("/api/contracts")) return "contracts";
  if (clean.startsWith("/api/tokens")) return "tokens";
  if (clean.startsWith("/api/transactions")) return "transactions";
  if (clean.startsWith("/api/wallets") || clean.startsWith("/api/accounts")) return "wallets";
  if (clean.startsWith("/api/rpc") || clean.startsWith("/rpc")) return "rpc";
  if (clean.startsWith("/api/webhooks") || clean.startsWith("/api/billing")) return "webhooks";
  if (clean.startsWith("/api/admin") || clean.startsWith("/api/setup")) return "admin";
  if (
    clean === "/metrics" ||
    clean.startsWith("/api/alerts") ||
    clean.startsWith("/api/load-shedder") ||
    clean.startsWith("/api/status") ||
    clean.startsWith("/api/operator") ||
    clean.startsWith("/api/observability")
  ) {
    return "system";
  }
  return "other";
}

const SAMPLE_CAP = 500;

function createFamilyStore() {
  const store = {};
  for (const family of ROUTE_FAMILIES) {
    store[family] = {
      serverSamples: [],
      upstreamSamples: [],
      totalSamples: [],
      count: 0,
    };
  }
  return store;
}

let _stats = createFamilyStore();

export function clearLatencySamplesForTest() {
  _stats = createFamilyStore();
}

/**
 * Record upstream latency for the active request
 * @param {number} durationMs
 */
export function recordUpstreamLatency(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0);
  const store = requestContext?.getStore?.();
  if (store) {
    store.upstreamLatencyMs = (store.upstreamLatencyMs || 0) + ms;
  }
}

/**
 * Calculate statistical distribution for an array of numbers
 */
function calculateDistribution(samples) {
  if (!samples || samples.length === 0) {
    return {
      count: 0,
      avgMs: null,
      p50Ms: null,
      p90Ms: null,
      p99Ms: null,
      minMs: null,
      maxMs: null,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = Math.round((sum / count) * 100) / 100;
  const min = Math.round(sorted[0] * 100) / 100;
  const max = Math.round(sorted[count - 1] * 100) / 100;

  const p50 = Math.round(sorted[Math.min(Math.floor(count * 0.5), count - 1)] * 100) / 100;
  const p90 = Math.round(sorted[Math.min(Math.floor(count * 0.9), count - 1)] * 100) / 100;
  const p99 = Math.round(sorted[Math.min(Math.floor(count * 0.99), count - 1)] * 100) / 100;

  return {
    count,
    avgMs: avg,
    p50Ms: p50,
    p90Ms: p90,
    p99Ms: p99,
    minMs: min,
    maxMs: max,
  };
}

/**
 * Record request latency sample into route-family distributions and Prometheus
 */
export function recordRequestLatency({ routeFamily, method = "GET", status = "200", totalMs, upstreamMs = 0 }) {
  const family = ROUTE_FAMILIES.includes(routeFamily) ? routeFamily : "other";
  const total = Math.max(0, Number(totalMs) || 0);
  const upstream = Math.max(0, Number(upstreamMs) || 0);
  const server = Math.max(0, total - upstream);

  const entry = _stats[family] || _stats.other;
  entry.count += 1;

  entry.totalSamples.push(total);
  if (entry.totalSamples.length > SAMPLE_CAP) entry.totalSamples.shift();

  entry.serverSamples.push(server);
  if (entry.serverSamples.length > SAMPLE_CAP) entry.serverSamples.shift();

  if (upstream > 0) {
    entry.upstreamSamples.push(upstream);
    if (entry.upstreamSamples.length > SAMPLE_CAP) entry.upstreamSamples.shift();
  }

  // Publish to Prometheus histograms
  try {
    const totalSec = total / 1000;
    const serverSec = server / 1000;
    const upstreamSec = upstream / 1000;
    const strMethod = String(method);
    const strStatus = String(status);

    apiRouteFamilyDuration?.observe({ route_family: family, method: strMethod, status: strStatus, type: "total" }, totalSec);
    apiRouteFamilyDuration?.observe({ route_family: family, method: strMethod, status: strStatus, type: "server" }, serverSec);
    if (upstream > 0) {
      apiRouteFamilyDuration?.observe({ route_family: family, method: strMethod, status: strStatus, type: "upstream" }, upstreamSec);
    }
  } catch {
    // Metric registration failures should never fail the request
  }
}

/**
 * Get aggregated latency distributions
 */
export function getLatencyDistributions(filter = {}) {
  const { route_family } = filter;

  if (route_family) {
    const normalized = String(route_family).toLowerCase().trim();
    if (!ROUTE_FAMILIES.includes(normalized)) {
      throw Object.assign(
        new Error(`Invalid route_family: '${route_family}'. Supported: ${ROUTE_FAMILIES.join(", ")}`),
        { statusCode: 400 },
      );
    }

    const familyData = _stats[normalized] || {
      count: 0,
      serverSamples: [],
      upstreamSamples: [],
      totalSamples: [],
    };

    return {
      timestamp: new Date().toISOString(),
      route_family: normalized,
      count: familyData.count,
      server: calculateDistribution(familyData.serverSamples),
      upstream: calculateDistribution(familyData.upstreamSamples),
      total: calculateDistribution(familyData.totalSamples),
    };
  }

  const result = {};
  for (const family of ROUTE_FAMILIES) {
    const familyData = _stats[family];
    result[family] = {
      count: familyData.count,
      server: calculateDistribution(familyData.serverSamples),
      upstream: calculateDistribution(familyData.upstreamSamples),
      total: calculateDistribution(familyData.totalSamples),
    };
  }

  return {
    timestamp: new Date().toISOString(),
    route_families: result,
  };
}
