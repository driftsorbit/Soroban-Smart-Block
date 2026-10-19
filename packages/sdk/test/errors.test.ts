import { describe, it, expect } from 'vitest';
import {
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError,
  NetworkError,
  TimeoutError,
  CancelledError,
  ExplorerError,
  createApiError,
  isRetryableStatus,
} from '../src/errors';
import type { ResponseMetadata } from '../src/types';

function meta(headers: Record<string, string> = {}, status = 400, statusText = 'Bad Request'): ResponseMetadata {
  return {
    status,
    statusText,
    headers: new Headers(headers),
  };
}

describe('createApiError (#1081)', () => {
  it('maps 400 to a non-retryable ValidationError', () => {
    const err = createApiError(400, 'Bad Request', { error: 'invalid_fields', message: 'bad' }, meta());
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(ExplorerError);
    expect(err.retryable).toBe(false);
  });

  it('maps 422 to a ValidationError and keeps the API error code', () => {
    const err = createApiError(422, 'Unprocessable', { error: 'Invalid limit' }, meta({}, 422));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('Invalid limit');
    expect(err.message).toBe('Invalid limit');
  });

  it('maps 401/403/404/409 to the matching types, all non-retryable', () => {
    const cases: Array<[number, unknown]> = [
      [401, AuthenticationError],
      [403, AuthorizationError],
      [404, NotFoundError],
      [409, ConflictError],
    ];
    for (const [status, Ctor] of cases) {
      const err = createApiError(status, 'x', { error: 'e' }, meta({}, status));
      expect(err).toBeInstanceOf(Ctor as unknown as new () => Error);
      expect(err.retryable).toBe(false);
    }
  });

  it('maps 429 to a retryable RateLimitError with retryAfter from the header', () => {
    const err = createApiError(429, 'Too Many Requests', { error: 'rate_limited' }, meta({ 'retry-after': '12' }, 429));
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryable).toBe(true);
    expect(err.retryAfter).toBe(12);
  });

  it('maps 5xx to a retryable ServerError', () => {
    for (const status of [500, 502, 503]) {
      const err = createApiError(status, 'boom', { error: 'server_error' }, meta({}, status));
      expect(err).toBeInstanceOf(ServerError);
      expect(err.retryable).toBe(true);
    }
  });

  it('extracts requestId from the header, preferring x-request-id', () => {
    const err = createApiError(500, 'x', {}, meta({ 'x-request-id': 'abc-123' }, 500));
    expect(err.requestId).toBe('abc-123');
  });

  it('falls back to a body request_id when no header is present', () => {
    const err = createApiError(500, 'x', { request_id: 'body-id' }, meta({}, 500));
    expect(err.requestId).toBe('body-id');
  });

  it('surfaces structured validation details', () => {
    const err = createApiError(422, 'x', { error: 'invalid', details: { limit: 'must be <= 200' } }, meta({}, 422));
    expect(err.details).toEqual({ limit: 'must be <= 200' });
  });

  it('falls back to an errors array as details', () => {
    const err = createApiError(400, 'x', { error: 'invalid', errors: ['a', 'b'] }, meta());
    expect(err.details).toEqual(['a', 'b']);
  });

  it('falls back to a generic code when the body carries none', () => {
    const err = createApiError(500, 'Internal Server Error', undefined, meta({}, 500));
    expect(err.code).toBe('server_error');
    expect(err.retryable).toBe(true);
  });
});

describe('isRetryableStatus (#1081)', () => {
  it('marks 408/425/429 and 5xx retryable', () => {
    for (const s of [408, 425, 429, 500, 503, 504]) {
      expect(isRetryableStatus(s)).toBe(true);
    }
  });

  it('marks 4xx client errors (other than above) non-retryable', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      expect(isRetryableStatus(s)).toBe(false);
    }
  });
});

describe('typed error classes (#1081)', () => {
  it('NetworkError is retryable and preserves the cause', () => {
    const cause = new TypeError('Failed to fetch');
    const err = new NetworkError('Network error: Failed to fetch', { cause });
    expect(err).toBeInstanceOf(ExplorerError);
    expect(err).toBeInstanceOf(Error);
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('network_error');
    expect((err as unknown as { cause?: unknown }).cause).toBe(cause);
  });

  it('TimeoutError is retryable and exposes timeoutMs', () => {
    const err = new TimeoutError('Request timeout after 30000ms', { timeoutMs: 30000 });
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(30000);
  });

  it('CancelledError is not retryable by default', () => {
    const err = new CancelledError();
    expect(err).toBeInstanceOf(CancelledError);
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('request_cancelled');
  });

  it('ApiError subclasses are instanceof ApiError and Error', () => {
    expect(new ValidationError(422, 'x', {}, meta())).toBeInstanceOf(ApiError);
    expect(new RateLimitError(429, 'x', {}, meta())).toBeInstanceOf(ApiError);
    expect(new ServerError(500, 'x', {}, meta())).toBeInstanceOf(ApiError);
    expect(new NotFoundError(404, 'x', {}, meta())).toBeInstanceOf(Error);
  });
});
