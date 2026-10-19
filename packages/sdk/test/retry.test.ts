import { describe, it, expect, vi } from 'vitest';
import {
  ExplorerApiClient,
  ApiError,
  calculateBackoffDelay,
  parseRetryAfter,
  isRetryableMethod,
  isRetryableStatus,
} from '../src/index.js';

describe('Retry and backoff policies (#1082)', () => {
  describe('Helper functions', () => {
    it('parseRetryAfter parses delta-seconds', () => {
      expect(parseRetryAfter('30')).toBe(30_000);
      expect(parseRetryAfter('0')).toBe(0);
      expect(parseRetryAfter('-5')).toBeNull();
      expect(parseRetryAfter(null)).toBeNull();
    });

    it('parseRetryAfter parses HTTP-date', () => {
      const future = new Date(Date.now() + 60_000).toUTCString();
      const parsed = parseRetryAfter(future);
      expect(parsed).toBeGreaterThan(50_000);
      expect(parsed).toBeLessThanOrEqual(60_000);
    });

    it('isRetryableMethod allows idempotent reads and forbids non-idempotent writes', () => {
      expect(isRetryableMethod('GET')).toBe(true);
      expect(isRetryableMethod('HEAD')).toBe(true);
      expect(isRetryableMethod('OPTIONS')).toBe(true);

      // Writes are NOT retryable by default
      expect(isRetryableMethod('POST')).toBe(false);
      expect(isRetryableMethod('PATCH')).toBe(false);
      expect(isRetryableMethod('DELETE')).toBe(false);
      expect(isRetryableMethod('PUT')).toBe(false);

      // Unless explicitly flagged idempotent
      expect(isRetryableMethod('POST', undefined, true)).toBe(true);
      expect(isRetryableMethod('DELETE', undefined, true)).toBe(true);
    });

    it('isRetryableStatus recognizes transient 5xx, 429, and 408', () => {
      expect(isRetryableStatus(429)).toBe(true);
      expect(isRetryableStatus(500)).toBe(true);
      expect(isRetryableStatus(502)).toBe(true);
      expect(isRetryableStatus(503)).toBe(true);
      expect(isRetryableStatus(504)).toBe(true);
      expect(isRetryableStatus(408)).toBe(true);

      // Non-retryable client errors
      expect(isRetryableStatus(400)).toBe(false);
      expect(isRetryableStatus(401)).toBe(false);
      expect(isRetryableStatus(403)).toBe(false);
      expect(isRetryableStatus(404)).toBe(false);
      expect(isRetryableStatus(422)).toBe(false);
    });

    it('calculateBackoffDelay respects Retry-After hint', () => {
      const delay = calculateBackoffDelay(1, { maxDelayMs: 60_000 }, '15');
      expect(delay).toBe(15_000);
    });

    it('calculateBackoffDelay scales exponentially without exceeding maxDelay', () => {
      const delay1 = calculateBackoffDelay(1, { initialDelayMs: 100, backoffFactor: 2, jitter: false });
      const delay2 = calculateBackoffDelay(2, { initialDelayMs: 100, backoffFactor: 2, jitter: false });
      const delay3 = calculateBackoffDelay(3, { initialDelayMs: 100, backoffFactor: 2, jitter: false });
      const delayMax = calculateBackoffDelay(10, { initialDelayMs: 100, maxDelayMs: 1000, jitter: false });

      expect(delay1).toBe(100);
      expect(delay2).toBe(200);
      expect(delay3).toBe(400);
      expect(delayMax).toBe(1000);
    });
  });

  describe('ExplorerApiClient retry behavior', () => {
    it('retries retryable reads on 503 and succeeds on subsequent attempt', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({ error: 'Service Unavailable' }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: 'success' }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: { maxRetries: 2, initialDelayMs: 10, jitter: false },
        });

        const res = await client.get('/api/events');
        expect(res.data).toEqual({ data: 'success' });
        expect(callCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('bounds retries to maxRetries on persistent failures', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'Internal Error' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: { maxRetries: 2, initialDelayMs: 10, jitter: false },
        });

        await expect(client.get('/api/events')).rejects.toThrow(ApiError);
        // Initial attempt (1) + 2 retries = 3 calls total
        expect(callCount).toBe(3);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('NEVER replays non-idempotent writes (POST) on 500 failure', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'Server crashed' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: { maxRetries: 3, initialDelayMs: 10 },
        });

        await expect(client.post('/api/contracts', { name: 'Token' })).rejects.toThrow(ApiError);
        // POST must not be retried — exactly 1 attempt
        expect(callCount).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('NEVER replays non-idempotent writes (DELETE) on network error', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        throw new TypeError('Failed to fetch');
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: { maxRetries: 3, initialDelayMs: 10 },
        });

        await expect(client.delete('/api/webhooks/123')).rejects.toThrow(/Network error/);
        // DELETE must not be retried — exactly 1 attempt
        expect(callCount).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('allows retry on POST when explicitly marked idempotent', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({ error: 'Rate limit' }), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ job: 'done' }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: { maxRetries: 2, initialDelayMs: 10, jitter: false },
        });

        const res = await client.post('/api/jobs', { type: 'export' }, { idempotent: true });
        expect(res.data).toEqual({ job: 'done' });
        expect(callCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('does not retry 4xx client errors like 404 or 400', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: { maxRetries: 3, initialDelayMs: 10 },
        });

        await expect(client.get('/api/contracts/non-existent')).rejects.toThrow(ApiError);
        expect(callCount).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('honors onRetry hook with attempt and status metadata', async () => {
      const attempts: number[] = [];
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        if (attempts.length === 0) {
          return new Response(JSON.stringify({ error: 'Gateway Timeout' }), {
            status: 504,
            statusText: 'Gateway Timeout',
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: {
            maxRetries: 2,
            initialDelayMs: 10,
            jitter: false,
            onRetry: (ctx) => attempts.push(ctx.attempt),
          },
        });

        await client.get('/api/health');
        expect(attempts).toEqual([1]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('disables retries when retry: false is configured', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn(async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'Temporary Error' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({ retry: false });

        await expect(client.get('/api/events')).rejects.toThrow(ApiError);
        expect(callCount).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
