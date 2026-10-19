/**
 * Webhook signature verification helpers (#1084).
 *
 * Verifies webhook deliveries against raw request bytes with timestamp tolerance
 * and replay protection.
 *
 * Webhooks delivered by the Soroban Smart Block Explorer carry:
 *   - `X-Webhook-Signature: sha256=<hex>` (HMAC-SHA256 of the raw body)
 *   - `X-Webhook-Timestamp: <unix_seconds>` (timestamp of delivery)
 *
 * Always verify against the raw request body bytes, NOT re-serialized JSON.
 */

export interface VerifyWebhookOptions {
  /** The webhook secret returned when creating the subscription. */
  secret: string;
  /** Raw request body as string, Buffer, Uint8Array, or ArrayBuffer. */
  rawBody: string | Uint8Array | ArrayBuffer;
  /**
   * The signature header (e.g. `sha256=<hex>` or `t=<ts>,v1=<hex>`).
   * If omitted, extracted from `headers`.
   */
  signature?: string;
  /** Request headers object (case-insensitive lookup). */
  headers?: Record<string, string | string[] | undefined> | Headers;
  /**
   * Delivery timestamp (unix seconds, ms, or ISO string).
   * If omitted, extracted from `headers` (`x-webhook-timestamp`) or signature (`t=...`).
   */
  timestamp?: number | string | Date;
  /**
   * Maximum allowed age in seconds for timestamp validation.
   * Defaults to 300 (5 minutes). Set to 0 to disable timestamp tolerance enforcement.
   */
  tolerance?: number;
  /** Current time reference for timestamp checking. Defaults to Date.now(). */
  now?: number | string | Date;
  /**
   * Optional cache or Set to prevent replay attacks by tracking seen signatures or event IDs.
   */
  replayCache?: {
    has: (key: string) => boolean;
    add: (key: string) => void;
  };
}

export type WebhookErrorCode =
  | 'missing_secret'
  | 'missing_payload'
  | 'missing_signature'
  | 'invalid_signature_format'
  | 'signature_mismatch'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'replay_detected';

export interface WebhookVerificationResult<T = unknown> {
  valid: boolean;
  error?: WebhookErrorCode;
  message?: string;
  payload?: T;
  timestamp?: number;
}

export class WebhookVerificationError extends Error {
  readonly code: WebhookErrorCode;

  constructor(code: WebhookErrorCode, message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
    this.code = code;
    Object.setPrototypeOf(this, WebhookVerificationError.prototype);
  }
}

const encoder = new TextEncoder();

/**
 * Constant-time comparison of two Uint8Arrays to prevent timing attacks.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let c = 0;
  for (let i = 0; i < a.length; i++) {
    c |= a[i] ^ b[i];
  }
  return c === 0;
}

function toUint8Array(input: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof input === 'string') {
    return encoder.encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return new Uint8Array(0);
}

function getHeader(
  headers: Record<string, string | string[] | undefined> | Headers | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    const val = (headers as Headers).get(name);
    return val ?? undefined;
  }
  const target = name.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return undefined;
}

function parseTimestamp(ts: number | string | Date | undefined): number | null {
  if (ts === undefined || ts === null) return null;
  if (typeof ts === 'number') {
    // If given in milliseconds (more than 10^11), convert to seconds
    return ts > 1e11 ? Math.floor(ts / 1000) : Math.floor(ts);
  }
  if (ts instanceof Date) {
    return Math.floor(ts.getTime() / 1000);
  }
  if (typeof ts === 'string') {
    const trimmed = ts.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return null;
}

function parseSignatureHeader(header: string): { signatureHex: string; timestampFromHeader?: number } {
  const trimmed = header.trim();

  // Format 1: `sha256=<hex>`
  if (trimmed.startsWith('sha256=')) {
    return { signatureHex: trimmed.slice(7).trim().toLowerCase() };
  }

  // Format 2: `t=<timestamp>,v1=<hex>` or `v1=<hex>,t=<timestamp>`
  if (trimmed.includes('=')) {
    let t: number | undefined;
    let sig: string | undefined;
    for (const part of trimmed.split(',')) {
      const [k, v] = part.split('=').map((s) => s.trim());
      if (k === 't') {
        const parsedT = parseTimestamp(v);
        if (parsedT !== null) t = parsedT;
      } else if (k === 'v1' || k === 'sha256' || k === 'sig') {
        sig = v.toLowerCase();
      }
    }
    if (sig) {
      return { signatureHex: sig, timestampFromHeader: t };
    }
  }

  // Format 3: Raw hex string (64 characters for sha256)
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return { signatureHex: trimmed.toLowerCase() };
  }

  return { signatureHex: trimmed.toLowerCase() };
}

async function computeHmacSha256Hex(secret: string, bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, bytes);
  return Array.from(new Uint8Array(signatureBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a webhook delivery signature against raw request body bytes.
 *
 * @param options Webhook verification parameters
 * @returns Verification result with `valid: true` and parsed payload, or `valid: false` with error reason
 */
export async function verifyWebhookSignature<T = unknown>(
  options: VerifyWebhookOptions
): Promise<WebhookVerificationResult<T>> {
  if (!options) {
    return { valid: false, error: 'missing_secret', message: 'Verification options are required' };
  }

  const { secret, tolerance = 300 } = options;

  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    return { valid: false, error: 'missing_secret', message: 'Webhook secret is required' };
  }

  if (options.rawBody === undefined || options.rawBody === null) {
    return { valid: false, error: 'missing_payload', message: 'Raw request body is required' };
  }

  const rawBytes = toUint8Array(options.rawBody);

  // Extract signature from options.signature or headers
  let rawSigHeader = options.signature;
  if (!rawSigHeader && options.headers) {
    rawSigHeader =
      getHeader(options.headers, 'x-webhook-signature') ||
      getHeader(options.headers, 'webhook-signature') ||
      getHeader(options.headers, 'stripe-signature');
  }

  if (!rawSigHeader || typeof rawSigHeader !== 'string' || rawSigHeader.trim() === '') {
    return { valid: false, error: 'missing_signature', message: 'Webhook signature header is missing' };
  }

  const { signatureHex, timestampFromHeader } = parseSignatureHeader(rawSigHeader);

  if (!signatureHex || !/^[0-9a-f]{64}$/.test(signatureHex)) {
    return {
      valid: false,
      error: 'invalid_signature_format',
      message: 'Signature format is invalid (expected 64-character hex)',
    };
  }

  // Extract timestamp from options, header, or signature
  let rawTimestamp = options.timestamp ?? timestampFromHeader;
  if (rawTimestamp === undefined && options.headers) {
    rawTimestamp =
      getHeader(options.headers, 'x-webhook-timestamp') ||
      getHeader(options.headers, 'webhook-timestamp');
  }

  const parsedTs = parseTimestamp(rawTimestamp);

  // Check timestamp tolerance if tolerance > 0
  if (tolerance > 0) {
    if (parsedTs === null) {
      return {
        valid: false,
        error: 'missing_timestamp',
        message: 'Timestamp is missing or invalid but tolerance is enforced',
      };
    }

    const nowSeconds =
      options.now !== undefined
        ? parseTimestamp(options.now) ?? Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

    const age = Math.abs(nowSeconds - parsedTs);
    if (age > tolerance) {
      return {
        valid: false,
        error: 'timestamp_out_of_tolerance',
        message: `Webhook timestamp (${parsedTs}) is outside the tolerance window of ${tolerance}s (diff: ${age}s)`,
        timestamp: parsedTs,
      };
    }
  }

  // Replay check using replayCache
  const replayKey = `${parsedTs ?? 'notime'}:${signatureHex}`;
  if (options.replayCache) {
    if (options.replayCache.has(replayKey)) {
      return {
        valid: false,
        error: 'replay_detected',
        message: 'Replay detected: this webhook signature has already been processed',
        timestamp: parsedTs ?? undefined,
      };
    }
  }

  // Calculate HMAC-SHA256
  // Standard format signs rawBody directly (matches indexer signPayload)
  const expectedHex = await computeHmacSha256Hex(secret, rawBytes);

  const sigBytes = encoder.encode(signatureHex);
  const expectedBytes = encoder.encode(expectedHex);

  if (!timingSafeEqual(sigBytes, expectedBytes)) {
    return {
      valid: false,
      error: 'signature_mismatch',
      message: 'HMAC signature does not match payload',
      timestamp: parsedTs ?? undefined,
    };
  }

  // Mark replay cache on successful verification
  if (options.replayCache) {
    options.replayCache.add(replayKey);
  }

  // Parse payload JSON if possible
  let payload: T | undefined;
  try {
    const rawString = typeof options.rawBody === 'string'
      ? options.rawBody
      : new TextDecoder().decode(rawBytes);
    payload = JSON.parse(rawString) as T;
  } catch {
    // If not JSON, leave payload undefined
  }

  return {
    valid: true,
    payload,
    timestamp: parsedTs ?? undefined,
  };
}

/**
 * Assert that a webhook delivery is valid. Throws `WebhookVerificationError` on failure.
 *
 * @param options Webhook verification parameters
 * @returns Parsed payload of type T (or boolean true if not JSON)
 */
export async function assertWebhookSignature<T = unknown>(
  options: VerifyWebhookOptions
): Promise<T> {
  const result = await verifyWebhookSignature<T>(options);
  if (!result.valid) {
    throw new WebhookVerificationError(
      result.error || 'signature_mismatch',
      result.message || 'Webhook verification failed'
    );
  }
  return (result.payload ?? (true as unknown)) as T;
}

/**
 * Creates an in-memory replay cache with automatic expiration.
 *
 * @param ttlMs Time-to-live for cache entries in milliseconds (default: 10 minutes)
 */
export function createReplayCache(ttlMs = 600_000): {
  has: (key: string) => boolean;
  add: (key: string) => void;
  clear: () => void;
} {
  const cache = new Map<string, number>();

  function prune() {
    const now = Date.now();
    for (const [key, expiresAt] of cache.entries()) {
      if (now > expiresAt) {
        cache.delete(key);
      }
    }
  }

  return {
    has(key: string): boolean {
      prune();
      return cache.has(key);
    },
    add(key: string): void {
      prune();
      cache.set(key, Date.now() + ttlMs);
    },
    clear(): void {
      cache.clear();
    },
  };
}
