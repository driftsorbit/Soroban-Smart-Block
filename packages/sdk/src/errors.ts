/**
 * First-class API error types (#1081).
 *
 * The API signals failure with an HTTP status plus a JSON body such as
 * `{ error: "invalid_cursor", message: "..." }`. Wrapping all of that in a
 * single `ApiError` forces every caller to hand-roll status switches.
 *
 * Instead, `createApiError` maps a failed response onto a small typed class
 * hierarchy so callers can `catch` on what they actually care about:
 *
 * ```
 * try { await client.get('/api/events'); }
 * catch (e) {
 *   if (e instanceof RateLimitError)      return backoff(e.retryAfter);
 *   if (e instanceof ValidationError)     return e.details;
 *   if (e instanceof ApiError && e.retryable) return retry();
 *   throw e;
 * }
 * ```
 *
 * Every error carries:
 *   - `code`     a stable machine-readable identifier
 *   - `retryable` whether retrying the identical request may succeed
 *   - `requestId` the server-assigned request id, when present
 *   - `details`  structured validation details, when present
 */

import type { ResponseMetadata } from './types.js';

/** Stable machine-readable error codes emitted by the SDK. */
export const SDK_ERROR_CODES = Object.freeze({
  NETWORK: 'network_error',
  TIMEOUT: 'request_timeout',
  CANCELLED: 'request_cancelled',
  PARSE_FAILED: 'parse_failed',
  // Generic fallbacks — real responses carry the API's own `error` field.
  VALIDATION: 'validation_failed',
  AUTHENTICATION: 'unauthenticated',
  AUTHORIZATION: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMIT: 'rate_limited',
  SERVER: 'server_error',
  API: 'api_error',
});

/** Statuses the server explicitly documents as retryable. */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

/** Base class for every error thrown by the SDK. */
export class ExplorerError extends Error {
  /** Stable machine-readable code. */
  readonly code: string;
  /** Retrying the identical request may succeed. */
  readonly retryable: boolean;
  /** Server-assigned request id, when the response carried one. */
  readonly requestId?: string;

  constructor(
    message: string,
    options: { code: string; retryable: boolean; requestId?: string; cause?: unknown } = {
      code: SDK_ERROR_CODES.API,
      retryable: false,
    },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.code = options.code;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface ApiErrorOptions {
  /** Overrides the code inferred from the status. */
  code?: string;
  requestId?: string;
  /** Structured validation details, when present in the body. */
  details?: unknown;
  retryable?: boolean;
  /** Parsed `Retry-After`, in seconds, when present. */
  retryAfter?: number;
}

/** An HTTP error response from the explorer API. */
export class ApiError extends ExplorerError {
  readonly status: number;
  readonly statusText: string;
  readonly data: unknown;
  readonly meta: ResponseMetadata;
  /** Structured validation details, when the server provided them. */
  readonly details?: unknown;
  /** Seconds to wait before retrying, parsed from `Retry-After` (429 etc). */
  readonly retryAfter?: number;

  constructor(
    status: number,
    statusText: string,
    data: unknown,
    meta: ResponseMetadata,
    options: ApiErrorOptions = {},
  ) {
    const message = resolveMessage(data) ?? `API Error ${status}: ${statusText}`;
    super(message, {
      code: options.code ?? SDK_ERROR_CODES.API,
      retryable: options.retryable ?? isRetryableStatus(status),
      requestId: options.requestId,
    });
    this.status = status;
    this.statusText = statusText;
    this.data = data;
    this.meta = meta;
    this.details = options.details;
    this.retryAfter = options.retryAfter;
  }
}

/** 400 / 422 — the request was rejected before it did any work. */
export class ValidationError extends ApiError {
  constructor(status: number, statusText: string, data: unknown, meta: ResponseMetadata, options: ApiErrorOptions = {}) {
    super(status, statusText, data, meta, { retryable: false, ...options, code: options.code ?? SDK_ERROR_CODES.VALIDATION });
  }
}

/** 401 — no valid credentials. */
export class AuthenticationError extends ApiError {
  constructor(status: number, statusText: string, data: unknown, meta: ResponseMetadata, options: ApiErrorOptions = {}) {
    super(status, statusText, data, meta, { retryable: false, ...options, code: options.code ?? SDK_ERROR_CODES.AUTHENTICATION });
  }
}

/** 403 — authenticated but not permitted. */
export class AuthorizationError extends ApiError {
  constructor(status: number, statusText: string, data: unknown, meta: ResponseMetadata, options: ApiErrorOptions = {}) {
    super(status, statusText, data, meta, { retryable: false, ...options, code: options.code ?? SDK_ERROR_CODES.AUTHORIZATION });
  }
}

/** 404 — the resource does not exist. */
export class NotFoundError extends ApiError {
  constructor(status: number, statusText: string, data: unknown, meta: ResponseMetadata, options: ApiErrorOptions = {}) {
    super(status, statusText, data, meta, { retryable: false, ...options, code: options.code ?? SDK_ERROR_CODES.NOT_FOUND });
  }
}

/** 409 — the request conflicts with the current state. */
export class ConflictError extends ApiError {
  constructor(status: number, statusText: string, data: unknown, meta: ResponseMetadata, options: ApiErrorOptions = {}) {
    super(status, statusText, data, meta, { retryable: false, ...options, code: options.code ?? SDK_ERROR_CODES.CONFLICT });
  }
}

/** 429 — rate limited. `retryAfter` carries the server's back-off hint. */
export class RateLimitError extends ApiError {
  constructor(status: number, statusText: string, data: unknown, meta: ResponseMetadata, options: ApiErrorOptions = {}) {
    super(status, statusText, data, meta, { retryable: true, ...options, code: options.code ?? SDK_ERROR_CODES.RATE_LIMIT });
  }
}

/** 5xx — the server failed to complete the request. */
export class ServerError extends ApiError {
  constructor(status: number, statusText: string, data: unknown, meta: ResponseMetadata, options: ApiErrorOptions = {}) {
    super(status, statusText, data, meta, { retryable: true, ...options, code: options.code ?? SDK_ERROR_CODES.SERVER });
  }
}

/** The request never reached the server (DNS, TLS, connection reset). */
export class NetworkError extends ExplorerError {
  constructor(message: string, options: { code?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { code: options.code ?? SDK_ERROR_CODES.NETWORK, retryable: options.retryable ?? true, cause: options.cause });
  }
}

/** The request exceeded the client timeout. */
export class TimeoutError extends ExplorerError {
  constructor(message: string, options: { code?: string; retryable?: boolean; timeoutMs?: number; cause?: unknown } = {}) {
    super(message, { code: options.code ?? SDK_ERROR_CODES.TIMEOUT, retryable: options.retryable ?? true, cause: options.cause });
    this.timeoutMs = options.timeoutMs;
  }
  /** The configured timeout that was exceeded, in milliseconds. */
  readonly timeoutMs?: number;
}

/** The request was cancelled by the caller before it completed. */
export class CancelledError extends ExplorerError {
  constructor(message = 'Request cancelled by caller', options: { code?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { code: options.code ?? SDK_ERROR_CODES.CANCELLED, retryable: options.retryable ?? false, cause: options.cause });
  }
}

/** True for statuses that the API documents as worth retrying. */
export function isRetryableStatus(status: number): boolean {
  if (RETRYABLE_STATUSES.has(status)) return true;
  return status >= 500;
}

function resolveMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const body = data as Record<string, unknown>;
  if (typeof body.message === 'string' && body.message) return body.message;
  if (typeof body.error === 'string' && body.error) return body.error;
  return undefined;
}

function resolveCode(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const body = data as Record<string, unknown>;
  if (typeof body.error === 'string' && body.error) return body.error;
  if (typeof body.code === 'string' && body.code) return body.code;
  return undefined;
}

function resolveDetails(data: unknown): unknown {
  if (!data || typeof data !== 'object') return undefined;
  const body = data as Record<string, unknown>;
  if (body.details !== undefined) return body.details;
  if (body.errors !== undefined) return body.errors;
  return undefined;
}

function headerValue(meta: ResponseMetadata | undefined, name: string): string | undefined {
  const value = meta?.headers?.get?.(name);
  return value == null ? undefined : value;
}

function resolveRequestId(data: unknown, meta: ResponseMetadata | undefined): string | undefined {
  const fromHeader =
    headerValue(meta, 'x-request-id') ??
    headerValue(meta, 'request-id') ??
    headerValue(meta, 'x-amzn-requestid') ??
    headerValue(meta, 'x-trace-id');
  if (fromHeader) return fromHeader;
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    for (const key of ['request_id', 'requestId', 'trace_id', 'traceId']) {
      if (typeof body[key] === 'string') return body[key] as string;
    }
  }
  return undefined;
}

function resolveRetryAfter(meta: ResponseMetadata | undefined, status: number): number | undefined {
  if (status !== 429 && status !== 503) return undefined;
  const raw = headerValue(meta, 'retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Map a failed HTTP response onto a typed error.
 *
 * @param status   HTTP status code
 * @param statusText HTTP status text
 * @param data     parsed JSON (or text) body
 * @param meta     response metadata (status, headers, rate-limit info)
 */
export function createApiError(
  status: number,
  statusText: string,
  data: unknown,
  meta: ResponseMetadata,
): ApiError {
  const requestId = resolveRequestId(data, meta);
  const retryAfter = resolveRetryAfter(meta, status);
  const options = {
    code: resolveCode(data),
    details: resolveDetails(data),
    requestId,
    retryAfter,
  };

  if (status === 401) return new AuthenticationError(status, statusText, data, meta, options);
  if (status === 403) return new AuthorizationError(status, statusText, data, meta, options);
  if (status === 404) return new NotFoundError(status, statusText, data, meta, options);
  if (status === 409) return new ConflictError(status, statusText, data, meta, options);
  if (status === 429) return new RateLimitError(status, statusText, data, meta, options);
  if (status === 400 || status === 422) return new ValidationError(status, statusText, data, meta, options);
  if (status >= 500) return new ServerError(status, statusText, data, meta, options);
  return new ApiError(status, statusText, data, meta, options);
}
