/**
 * Retry and backoff policies (#1082) & timeout/cancellation utilities (#1083).
 *
 * Enforces bounded retries for retryable reads, honors retry hints (Retry-After),
 * and prevents replaying non-idempotent writes.
 */

export interface RetryPolicy {
  /** Maximum number of retry attempts. Default: 3. Set to 0 to disable retries. */
  maxRetries?: number;
  /** Initial delay in ms before first retry. Default: 500ms. */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries. Default: 10000ms (10s). */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff. Default: 2. */
  backoffFactor?: number;
  /** Whether to add random jitter (up to 25%). Default: true. */
  jitter?: boolean;
  /**
   * HTTP status codes considered retryable.
   * Default: [408, 429, 500, 502, 503, 504].
   * 4xx client errors (400, 401, 403, 404, 422) are NOT retryable.
   */
  retryableStatusCodes?: number[];
  /**
   * HTTP methods considered safe/idempotent to retry.
   * Default: ['GET', 'HEAD', 'OPTIONS'].
   * Non-idempotent writes (POST, PATCH, DELETE) are NEVER retried by default.
   */
  retryableMethods?: string[];
  /** Custom callback to determine if an error or response should be retried. */
  shouldRetry?: (context: RetryContext) => boolean;
  /** Callback fired before each retry attempt. */
  onRetry?: (context: RetryContext) => void;
}

export interface RetryContext {
  attempt: number;
  maxRetries: number;
  method: string;
  url: string;
  error?: Error;
  status?: number;
  delayMs: number;
  retryAfterHeader?: string | null;
}

export class TimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export const DEFAULT_RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
export const DEFAULT_RETRYABLE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const DEFAULT_RETRY_POLICY: Required<Omit<RetryPolicy, 'shouldRetry' | 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffFactor: 2,
  jitter: true,
  retryableStatusCodes: DEFAULT_RETRYABLE_STATUS_CODES,
  retryableMethods: DEFAULT_RETRYABLE_METHODS,
};

/**
 * Parses the Retry-After header value into milliseconds.
 * Supports both delta-seconds (e.g., '120') and HTTP-date formats.
 */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.startsWith('-')) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return Math.max(0, diff);
  }
  return null;
}

/**
 * Calculates exponential backoff delay with optional jitter and Retry-After hint.
 */
export function calculateBackoffDelay(
  attempt: number,
  policy: RetryPolicy = {},
  retryAfterHeader?: string | null
): number {
  const initial = policy.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs;
  const factor = policy.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor;
  const maxDelay = policy.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs;
  const jitter = policy.jitter ?? DEFAULT_RETRY_POLICY.jitter;

  // Honor retry hint from header if present
  const hintMs = parseRetryAfter(retryAfterHeader);
  if (hintMs !== null) {
    return Math.min(hintMs, maxDelay);
  }

  // Exponential backoff: initial * (factor ^ (attempt - 1))
  const exponential = initial * Math.pow(factor, Math.max(0, attempt - 1));
  let delay = Math.min(exponential, maxDelay);

  if (jitter) {
    // Add jitter up to +25%
    delay = delay * (1 + Math.random() * 0.25);
  }

  return Math.min(Math.round(delay), maxDelay);
}

/**
 * Checks whether an HTTP method is eligible for automatic retry.
 * Non-idempotent writes (POST, PATCH, DELETE) are NEVER retried unless
 * explicitly marked idempotent.
 */
export function isRetryableMethod(
  method: string,
  policy?: RetryPolicy,
  idempotent?: boolean
): boolean {
  if (idempotent) return true;
  const upper = method.toUpperCase();
  const allowed = policy?.retryableMethods ?? DEFAULT_RETRYABLE_METHODS;
  return allowed.map((m) => m.toUpperCase()).includes(upper);
}

/**
 * Checks whether an HTTP status code is retryable.
 */
export function isRetryableStatus(status: number, policy?: RetryPolicy): boolean {
  const codes = policy?.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;
  return codes.includes(status);
}

/**
 * Checks whether an error is a retryable network error.
 */
export function isRetryableNetworkError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TimeoutError) return false;
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) return true;
  if (error instanceof Error && /network|econnreset|etimedout|enotfound/i.test(error.message)) return true;
  return false;
}

/**
 * Combines multiple AbortSignals into a single signal.
 */
export function combineSignals(...signals: (AbortSignal | undefined | null)[]): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const activeSignals = signals.filter((s): s is AbortSignal => Boolean(s));

  if (activeSignals.length === 0) {
    const controller = new AbortController();
    return { signal: controller.signal, cleanup: () => {} };
  }

  if (activeSignals.length === 1) {
    return { signal: activeSignals[0], cleanup: () => {} };
  }

  // Already aborted?
  for (const sig of activeSignals) {
    if (sig.aborted) {
      const controller = new AbortController();
      controller.abort(sig.reason);
      return { signal: controller.signal, cleanup: () => {} };
    }
  }

  // Use AbortSignal.any if available in runtime
  if (typeof (AbortSignal as any).any === 'function') {
    return { signal: (AbortSignal as any).any(activeSignals), cleanup: () => {} };
  }

  // Fallback composite controller
  const controller = new AbortController();
  const onAbort = (e: Event) => {
    const target = e.target as AbortSignal;
    controller.abort(target?.reason);
    cleanup();
  };

  const cleanup = () => {
    for (const sig of activeSignals) {
      sig.removeEventListener('abort', onAbort);
    }
  };

  for (const sig of activeSignals) {
    sig.addEventListener('abort', onAbort, { once: true });
  }

  return { signal: controller.signal, cleanup };
}

/**
 * Sleeps for a duration in milliseconds, aborting early if the signal is triggered.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }

    let timer: any = null;
    let onAbort: (() => void) | null = null;

    if (signal) {
      onAbort = () => {
        if (timer) clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
  });
}
