/**
 * Scoped API tokens (#901).
 *
 * Every route declares the scopes it needs in ROUTE_SCOPES; `assertRoutesDeclareScopes`
 * fails startup if a registered route is missing. `scopeMiddleware` enforces them
 * for requests authenticated with a DB-backed API key (req.rateContext.keyId).
 * Unauthenticated requests keep their existing access, and the static admin
 * key holds `admin:*`.
 *
 * A key may also be restricted to specific contract IDs and browser origins.
 * Scope changes take effect within the API-key cache TTL (30 s, apiKeyAuth.js).
 */

export const SCOPES = [
  "read:events",
  "read:contracts",
  "write:contracts",
  "write:webhooks",
  "read:usage",
  "write:keys",
  "admin:*",
];

/** Least-privilege default for new keys. */
export const DEFAULT_SCOPES = ["read:events", "read:contracts"];

/** Scopes given to keys that existed before scopes (their previous access). */
export const LEGACY_SCOPES = [
  "read:events",
  "read:contracts",
  "write:contracts",
  "write:webhooks",
  "read:usage",
  "write:keys",
];

const PUBLIC = [];
const R_EVENTS = ["read:events"];
const R_CONTRACTS = ["read:contracts"];
const W_CONTRACTS = ["write:contracts"];
const W_WEBHOOKS = ["write:webhooks"];
const R_USAGE = ["read:usage"];
const W_KEYS = ["write:keys"];
const ADMIN = ["admin:*"];

/**
 * Required scopes per route (`METHOD /express/path`). PUBLIC routes need no
 * scope (health, docs, key sign-up). Keep this table complete: startup fails
 * on any registered route that is missing.
 */
export const ROUTE_SCOPES = {
  // Public / infrastructure
  "GET /health": PUBLIC,
  "GET /health/live": PUBLIC,
  "GET /health/ready": PUBLIC,
  "GET /metrics": PUBLIC,
  "GET /api/health": PUBLIC,
  "GET /api/metrics": PUBLIC,
  "GET /api/openapi.yaml": PUBLIC,
  "GET /api/csrf-token": PUBLIC,
  "POST /api/csp-report": PUBLIC,
  "GET /api/status/history": PUBLIC,
  "GET /api/rpc/health": PUBLIC,
  "GET /api/rpc-metrics": PUBLIC,
  "GET /api/rpc-nodes": PUBLIC,
  "POST /api/keys": PUBLIC,
  "GET /api/keys/verify": PUBLIC,
  "GET /api/keys/introspect": PUBLIC, // any valid key; reports its own scopes
  "POST /api/billing/stripe-webhook": PUBLIC, // authenticated by Stripe's signature

  // Events and chain data
  "GET /api/events": R_EVENTS,
  "POST /api/events": R_EVENTS, // RPC-style filters in the body (#903)
  "GET /api/v1/events": R_EVENTS,
  "GET /api/events/:seq": R_EVENTS,
  "GET /api/events/:seq/zk-costs": R_EVENTS,
  "GET /api/export/events": R_EVENTS,
  "GET /api/search": R_EVENTS,
  "GET /api/stats": R_EVENTS,
  "GET /api/stats/decoder": R_EVENTS,
  "GET /api/gaps": R_EVENTS,
  "GET /api/alerts": R_EVENTS,
  "GET /api/burn-alerts": R_EVENTS,
  "GET /api/cache/stats": R_EVENTS,
  "GET /api/wallet/:address": R_EVENTS,
  "GET /api/wallet/:address/balances": R_EVENTS,
  "GET /api/assets": R_EVENTS,
  "GET /api/assets/:issuer/:code": R_EVENTS,
  "GET /api/transactions/status": R_EVENTS,
  "GET /api/transactions/:hash/status": R_EVENTS,
  "GET /api/transactions/:hash/status/stream": R_EVENTS,
  "GET /api/tokens/:id/holders": R_EVENTS,
  "GET /api/tokens/:id/volume": R_EVENTS,
  "GET /api/tokens/:contractId/nfts": R_EVENTS,
  "GET /api/tokens/:contractId/nfts/analytics": R_EVENTS,
  "GET /api/tokens/:contractId/nfts/:tokenId/history": R_EVENTS,
  "GET /api/queries": R_EVENTS,
  "POST /api/queries": R_EVENTS,
  "GET /api/queries/:id/events": R_EVENTS,
  "DELETE /api/queries/:id": R_EVENTS,
  "GET /graphql": R_EVENTS,
  "POST /graphql": R_EVENTS,

  // Contracts (read + simulation, which does not change state)
  "GET /api/contracts": R_CONTRACTS,
  "GET /api/contracts/:id": R_CONTRACTS,
  "GET /api/contracts/:id/abi": R_CONTRACTS,
  "GET /api/contracts/:id/abi-history": R_CONTRACTS,
  "GET /api/contracts/:id/build-metadata": R_CONTRACTS,
  "GET /api/contracts/:id/call-graph": R_CONTRACTS,
  "GET /api/contracts/:id/circuit-breaker": R_CONTRACTS,
  "GET /api/contracts/:id/events": R_CONTRACTS,
  "GET /api/contracts/:id/migration-status": R_CONTRACTS,
  "GET /api/contracts/:id/rwa-metadata": R_CONTRACTS,
  "GET /api/contracts/:id/source-verifications": R_CONTRACTS,
  "GET /api/contracts/:id/spec-full": R_CONTRACTS,
  "GET /api/contracts/:id/state-diffs": R_CONTRACTS,
  "GET /api/contracts/:id/stats": R_CONTRACTS,
  "GET /api/contracts/:id/storage-tiers": R_CONTRACTS,
  "GET /api/contracts/:id/ttl": R_CONTRACTS,
  "GET /api/contracts/:id/upgrades": R_CONTRACTS,
  "GET /api/contracts/:id/wasm": R_CONTRACTS,
  "GET /api/v1/contracts/:id/transactions": R_CONTRACTS,
  "GET /api/export/contracts": R_CONTRACTS,
  "GET /api/spec/:id": R_CONTRACTS,
  "GET /api/spec/:id/full": R_CONTRACTS,
  "GET /api/sandboxes": R_CONTRACTS,
  "GET /api/sandbox/:id": R_CONTRACTS,
  "POST /api/simulate": R_CONTRACTS,
  "POST /api/sandbox/simulate": R_CONTRACTS,
  "POST /api/sandbox/ledger-entries": R_CONTRACTS,
  "POST /api/sandbox/replay": R_CONTRACTS,
  "POST /api/sandbox/compare-protocols": R_CONTRACTS,
  "GET /api/sandbox/collections": R_CONTRACTS,
  "GET /api/sandbox/collections/:id": R_CONTRACTS,
  "POST /api/sandbox/collections/export": R_CONTRACTS,
  "POST /api/sandbox/validate-auth": R_CONTRACTS,
  "POST /api/auth-tree": R_CONTRACTS,
  "POST /api/batch": R_CONTRACTS,
  "POST /api/batch/estimate-gas": R_CONTRACTS,
  "POST /api/batch/optimize": R_CONTRACTS,
  "POST /api/batch/simulate": R_CONTRACTS,
  "POST /api/batch/validate": R_CONTRACTS,

  // Contract writes
  "POST /api/contracts": W_CONTRACTS,
  "PATCH /api/contracts/:id": W_CONTRACTS,
  "POST /api/contracts/:id/source-verifications": W_CONTRACTS,
  "POST /api/verify": W_CONTRACTS,
  "POST /api/sandbox": W_CONTRACTS,
  "DELETE /api/sandbox/:id": W_CONTRACTS,
  "POST /api/sandbox/collections": W_CONTRACTS,
  "DELETE /api/sandbox/collections/:id": W_CONTRACTS,
  "POST /api/sandbox/collections/import": W_CONTRACTS,
  "POST /api/collab/sessions": W_CONTRACTS,
  // Authorised by the session owner token (x-collab-token), not an API key.
  "POST /api/collab/sessions/:id/rotate": PUBLIC,
  "POST /api/collab/sessions/:id/kick": PUBLIC,

  // Webhooks
  "GET /api/webhooks": W_WEBHOOKS,
  "POST /api/webhooks": W_WEBHOOKS,
  "DELETE /api/webhooks/:id": W_WEBHOOKS,
  "POST /api/webhooks/:id/test": W_WEBHOOKS,
  "GET /api/webhooks/:id/deliveries": W_WEBHOOKS,
  "POST /api/webhooks/:id/deliveries/:delivery_id/retry": W_WEBHOOKS,

  // Self-service dashboard
  "GET /api/dashboard/me": R_USAGE,
  "GET /api/dashboard/api-keys": R_USAGE,
  "GET /api/dashboard/api-keys/:id/usage": R_USAGE,
  "POST /api/dashboard/api-keys": W_KEYS,
  "POST /api/dashboard/api-keys/:id/rotate": W_KEYS,
  "DELETE /api/dashboard/api-keys/:id": W_KEYS,
  "PUT /api/dashboard/api-keys/:id/allowed-ips": W_KEYS,

  // Admin / setup
  "GET /api/setup/doctor": ADMIN,
  "POST /api/setup/db-init": ADMIN,
  "POST /api/setup/save-config": ADMIN,
  "POST /api/setup/test-db": ADMIN,
  "GET /api/admin/integrity": ADMIN,
  "POST /api/admin/alerts/:condition/resolve": ADMIN,
  "GET /api/admin/api-keys": ADMIN,
  "POST /api/admin/api-keys": ADMIN,
  "PATCH /api/admin/api-keys/:id": ADMIN,
  "DELETE /api/admin/api-keys/:id": ADMIN,
  "POST /api/admin/api-keys/:id/rotate": ADMIN,
  "GET /api/admin/api-keys/:id/usage": ADMIN,
  "GET /api/admin/audit-log": ADMIN,
  "GET /api/admin/audit-log/export": ADMIN,
  "GET /api/admin/analytics/rate-limit-hits": ADMIN,
  "GET /api/admin/analytics/top-users": ADMIN,
  "GET /api/admin/analytics/violation-heatmap": ADMIN,
  "GET /api/admin/analytics/upgrade-recommendations": ADMIN,
  "POST /api/admin/abi/import-github": ADMIN,
  "POST /api/admin/dlq/:id/retry": ADMIN,
};

// List endpoints that return data across contracts: a contract-restricted key
// must scope them with ?contract=.
const CONTRACT_SCOPED_LISTS = new Set(["GET /api/events", "GET /api/v1/events", "GET /api/export/events"]);

const compiled = Object.entries(ROUTE_SCOPES).map(([route, scopes]) => {
  const [method, path] = route.split(" ");
  const names = [];
  const re = new RegExp(
    `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)"))}/?$`,
  );
  return {
    route,
    method,
    re,
    names,
    scopes,
    literalSegments: path.split("/").filter((s) => s && !s.startsWith(":")).length,
  };
});
// Prefer the most specific route (most literal segments) when several match.
compiled.sort((a, b) => b.literalSegments - a.literalSegments);

/** Resolve the declared route for a request. */
export function matchRoute(method, path) {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (m)
      return { route: r.route, scopes: r.scopes, params: Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}

/** `admin:*` satisfies every scope. */
export function hasScope(granted, required) {
  return granted.includes("admin:*") || granted.includes(required);
}

/** RFC 9457 Problem Details response. */
function problem(res, status, title, detail, extra = {}) {
  return res
    .status(status)
    .type("application/problem+json")
    .json({ type: "about:blank", title, status, detail, ...extra });
}

function contractIdFor(req, match) {
  const { id, contractId } = match.params;
  if (contractId) return contractId;
  if (id && /^\/api\/(v1\/)?(contracts|spec|tokens)\//.test(req.path)) return id;
  if (typeof req.query?.contract === "string") return req.query.contract;
  if (match.route === "POST /api/contracts" && typeof req.body?.id === "string") return req.body.id;
  return undefined;
}

/** Enforce declared scopes, contract restrictions and origin restrictions. */
export function scopeMiddleware(req, res, next) {
  const ctx = req.rateContext;
  if (!ctx?.keyId) return next(); // unauthenticated / static admin key: unchanged

  const match = matchRoute(req.method, req.path);
  if (!match) return next(); // undeclared (404s, static assets) — startup check covers real routes

  const granted = ctx.scopes ?? [];
  const missing = match.scopes.filter((s) => !hasScope(granted, s));
  if (missing.length) {
    return problem(res, 403, "Insufficient scope", `This API key lacks the ${missing.join(", ")} scope.`, {
      missing_scope: missing[0],
      required_scopes: match.scopes,
    });
  }

  const origins = ctx.allowedOrigins ?? [];
  if (origins.length && req.get("origin") && !origins.includes(req.get("origin"))) {
    return problem(res, 403, "Origin not allowed", `This API key cannot be used from ${req.get("origin")}.`);
  }

  const contracts = ctx.allowedContractIds ?? [];
  if (contracts.length && !granted.includes("admin:*")) {
    const contractId = contractIdFor(req, match);
    if (contractId && !contracts.includes(contractId)) {
      return problem(res, 403, "Insufficient scope", `This API key is not allowed to access contract ${contractId}.`, {
        missing_scope: `contract:${contractId}`,
      });
    }
    if (!contractId && CONTRACT_SCOPED_LISTS.has(match.route)) {
      return problem(
        res,
        403,
        "Insufficient scope",
        "This API key is restricted to specific contracts; pass ?contract=.",
        {
          missing_scope: "contract:*",
        },
      );
    }
  }
  next();
}

/** Every route registered on `app` (including mounted routers). */
export function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const full = `${prefix}${layer.route.path}`.replace(/(.)\/$/, "$1"); // router "/" → mount path
        for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${full}`);
      } else if (layer.name === "router" && layer.handle?.stack) {
        const mount = layer.regexp?.source
          .replace(/^\^/, "")
          .replace(/\\\/\?\(\?=\\\/\|\$\)$/i, "")
          .replace(/\\\//g, "/");
        walk(layer.handle.stack, prefix + (mount && mount !== "/?(?=/|$)" ? mount : ""));
      }
    }
  };
  walk(app._router?.stack ?? [], "");
  return [...new Set(out)];
}

/** Throws if any registered route does not declare its scopes. */
export function assertRoutesDeclareScopes(app) {
  const missing = listRoutes(app).filter((r) => !(r in ROUTE_SCOPES));
  if (missing.length) {
    throw new Error(`Routes without declared scopes (add them to auth/scopes.js ROUTE_SCOPES): ${missing.join(", ")}`);
  }
}

/** Normalise and validate requested scopes for a new key. */
export function normaliseScopes(requested, { allowAdmin = false } = {}) {
  if (requested === undefined || requested === null) return [...DEFAULT_SCOPES];
  if (!Array.isArray(requested) || requested.length === 0) throw new Error("scopes must be a non-empty array");
  for (const s of requested) {
    if (!SCOPES.includes(s)) throw new Error(`unknown scope: ${s}`);
    if (s === "admin:*" && !allowAdmin) throw new Error("admin:* cannot be granted here");
  }
  return [...new Set(requested)];
}
