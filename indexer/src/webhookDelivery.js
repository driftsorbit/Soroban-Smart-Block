import { logger } from "./logger.js";
/**
 * Webhook delivery — outbound POSTs to user-registered subscription URLs.
 *
 * Flow:
 *   1. index.js calls deliverWebhooksForEvent(decoded) right after an event
 *      is persisted (fire-and-forget, mirrors handleVaultEvent/cacheInvalidate).
 *   2. Each matching active subscription gets an immediate signed POST attempt,
 *      logged to webhook_deliveries via db.recordWebhookDelivery.
 *   3. A failed attempt is enqueued into the existing dead_letter_queue
 *      (indexer/src/deadLetterQueue.js) with a `kind: "webhook_delivery"`
 *      marker so index.js's DLQ retry loop can dispatch it to
 *      retryWebhookDelivery below instead of processSingleEvent.
 *   4. db.recordWebhookDelivery auto-disables a subscription (active=false)
 *      once WEBHOOK_MAX_CONSECUTIVE_FAILURES consecutive attempts fail.
 */

import { evaluateFilter, validateFilter } from "./filters/filter.js";
import crypto from "crypto";
import { db } from "./db.js";
import { enqueue as dlqEnqueue } from "./deadLetterQueue.js";
import { decryptSecret } from "./secrets/index.js";
import { assertSafeUrl, safeFetch } from "./safeHttp.js";

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BODY_CHARS = 4_000;

// ── HMAC signing ──────────────────────────────────────────────────────────────

export function signPayload(secret, body) {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

export function generateSecret() {
  return crypto.randomBytes(32).toString("hex");
}

// ── SSRF-safe URL validation ─────────────────────────────────────────────────

/**
 * Reject webhook URLs that could be used for SSRF (internal network access).
 * Delegates to the shared hardened client (safeHttp.js).
 *
 * @param {string} rawUrl
 * @throws {Error} if the URL is unsafe or malformed
 */
export async function assertSafeWebhookUrl(rawUrl) {
  await assertSafeUrl(rawUrl);
}

/** HEAD request used at subscription-creation time to confirm the URL is reachable. */
export async function checkReachable(url) {
  try {
    await safeFetch(url, { method: "HEAD", timeoutMs: DELIVERY_TIMEOUT_MS });
    return true;
  } catch (err) {
    throw new Error(`url is not reachable: ${err.message}`);
  }
}

// ── Delivery ──────────────────────────────────────────────────────────────────

function truncate(str) {
  if (str == null) return null;
  return str.length > MAX_RESPONSE_BODY_CHARS ? str.slice(0, MAX_RESPONSE_BODY_CHARS) : str;
}

function buildPayload(decoded) {
  return JSON.stringify({
    seq: decoded.seq ?? null,
    event_id: decoded.event_id ?? null,
    contract_id: decoded.contract_id,
    function: decoded.function,
    ledger: decoded.ledger,
    tx_hash: decoded.tx_hash,
    description: decoded.description,
    raw_topics: decoded.raw_topics,
    raw_data: decoded.raw_data,
    created_at: new Date().toISOString(),
  });
}

/** POST `body` to `url`, signed with `secret`. Returns the outcome for logging; never throws. */
async function sendOnce(url, secret, body) {
  const start = Date.now();
  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signPayload(decryptSecret(secret), body),
        "X-Webhook-Timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body,
      timeoutMs: DELIVERY_TIMEOUT_MS,
      maxBytes: 1024 * 1024,
    });
    const responseBody = await res.text().catch(() => "");
    return {
      success: res.ok,
      response_status: res.status,
      response_body: truncate(responseBody),
      duration_ms: Date.now() - start,
      error: res.ok ? null : new Error(`webhook endpoint responded ${res.status}`),
    };
  } catch (err) {
    return {
      success: false,
      response_status: null,
      response_body: null,
      duration_ms: Date.now() - start,
      error: err,
    };
  }
}

async function deliverToSubscription(sub, decoded) {
  const body = buildPayload(decoded);
  const outcome = await sendOnce(sub.url, sub.secret, body);

  await db.recordWebhookDelivery({
    webhook_id: sub.id,
    event_seq: decoded.seq ?? null,
    url: sub.url,
    request_body: body,
    response_status: outcome.response_status,
    response_body: outcome.response_body,
    duration_ms: outcome.duration_ms,
    success: outcome.success,
  });

  if (!outcome.success) {
    await dlqEnqueue(
      {
        kind: "webhook_delivery",
        webhook_id: sub.id,
        event_seq: decoded.seq ?? null,
        url: sub.url,
        request_body: body,
      },
      outcome.error ?? new Error("webhook delivery failed"),
    ).catch(() => {});
  }
}

/**
 * Send a synthetic test event to one subscription (the dashboard's "Send test
 * event" / test-fire action), logged the same way as a real delivery.
 * @param {object} sub  row from db.getWebhookSubscription (has url + secret)
 */
export async function sendTestEvent(sub) {
  const body = JSON.stringify({
    test: true,
    contract_id: sub.contract_id ?? "CTEST00000000000000000000000000000000000000000000000",
    function: sub.function_filter ?? "test_event",
    ledger: 0,
    tx_hash: "test",
    description: "Test event sent from the developer dashboard",
    created_at: new Date().toISOString(),
  });
  const outcome = await sendOnce(sub.url, sub.secret, body);

  return db.recordWebhookDelivery({
    webhook_id: sub.id,
    event_seq: null,
    url: sub.url,
    request_body: body,
    response_status: outcome.response_status,
    response_body: outcome.response_body,
    duration_ms: outcome.duration_ms,
    success: outcome.success,
  });
}

/**
 * Extract wallet addresses from an event's raw_topics. Looks for Stellar account
 * addresses (G...) in the topics array.
 */
function extractWalletsFromTopics(rawTopics) {
  const wallets = new Set();
  if (!Array.isArray(rawTopics)) return wallets;

  for (const topic of rawTopics) {
    if (typeof topic === "string") {
      // Match Stellar account addresses (G followed by 55 base32 chars)
      const matches = topic.match(/\bG[A-Z2-7]{55}\b/g);
      if (matches) {
        matches.forEach((addr) => wallets.add(addr));
      }
    }
  }
  return wallets;
}

/**
 * Check if an event matches a wallet address subscription.
 * Wallets can appear in event topics or in the description.
 */
function eventMatchesWallet(decoded, walletAddress) {
  if (!walletAddress) return true; // NULL wallet filter = match all

  const eventWallets = extractWalletsFromTopics(decoded.raw_topics || []);
  if (eventWallets.has(walletAddress)) return true;

  // Also check description for wallet address mentions
  if (decoded.description && decoded.description.includes(walletAddress)) return true;

  return false;
}

/** Apply a subscription's filter DSL predicate (#902); no filter matches everything. */
function eventMatchesFilter(decoded, filter) {
  if (!filter) return true;
  try {
    const ast = typeof filter === "string" ? JSON.parse(filter) : filter;
    return evaluateFilter(validateFilter(ast))(decoded);
  } catch {
    return false; // an unreadable stored filter never matches
  }
}

/** Find active subscriptions matching a newly-indexed event and deliver to each (fire-and-forget). */
export async function deliverWebhooksForEvent(decoded) {
  const candidates = await db.getMatchingWebhookSubscriptions(decoded.contract_id, decoded.function);
  // The DB query returns every active wallet-address subscription unfiltered;
  // apply the per-subscription wallet match here (topics + description).
  const subs = candidates.filter(
    (sub) => eventMatchesWallet(decoded, sub.wallet_address) && eventMatchesFilter(decoded, sub.filter),
  );
  await Promise.all(
    subs.map((sub) =>
      deliverToSubscription(sub, decoded).catch((err) =>
        logger.error(`[webhookDelivery] subscription ${sub.id} failed:`, err.message),
      ),
    ),
  );
}

/**
 * DLQ retry handler for `{ kind: "webhook_delivery" }` entries. Re-sends the
 * exact original payload (so the signature verifies against the same body)
 * using the subscription's current secret, and re-logs the attempt.
 * Throws on failure so dead_letter_queue.processRetries keeps backing off.
 */
export async function retryWebhookDelivery(rawEvent) {
  const sub = await db.getWebhookSubscription(rawEvent.webhook_id);
  if (!sub || !sub.active) return; // subscription deleted/auto-disabled — drop the retry

  const outcome = await sendOnce(sub.url, sub.secret, rawEvent.request_body);

  await db.recordWebhookDelivery({
    webhook_id: sub.id,
    event_seq: rawEvent.event_seq ?? null,
    url: sub.url,
    request_body: rawEvent.request_body,
    response_status: outcome.response_status,
    response_body: outcome.response_body,
    duration_ms: outcome.duration_ms,
    success: outcome.success,
  });

  if (!outcome.success) throw outcome.error ?? new Error("webhook retry failed");
}

/**
 * Manual retry triggered via POST /api/webhooks/:id/deliveries/:delivery_id/retry.
 * Re-sends the original delivery's request body immediately and logs a new
 * webhook_deliveries row for the attempt.
 *
 * @param {object} delivery  row from db.getWebhookDeliveryWithSubscription
 * @returns {Promise<object>} the newly-recorded delivery row
 */
export async function manualRetryDelivery(delivery) {
  const outcome = await sendOnce(delivery.webhook_url, delivery.secret, delivery.request_body);

  return db.recordWebhookDelivery({
    webhook_id: delivery.webhook_id,
    event_seq: delivery.event_seq,
    url: delivery.webhook_url,
    request_body: delivery.request_body,
    response_status: outcome.response_status,
    response_body: outcome.response_body,
    duration_ms: outcome.duration_ms,
    success: outcome.success,
  });
}
