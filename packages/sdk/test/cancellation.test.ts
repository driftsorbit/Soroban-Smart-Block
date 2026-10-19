import { describe, it, expect, vi } from 'vitest';
import {
  ExplorerApiClient,
  TimeoutError,
  combineSignals,
  sleep,
} from '../src/index.js';

describe('Request cancellation and timeout options (#1083)', () => {
  describe('combineSignals helper', () => {
    it('returns a single signal when only one provided', () => {
      const c = new AbortController();
      const { signal } = combineSignals(c.signal);
      expect(signal).toBe(c.signal);
    });

    it('aborts composite signal when any input signal aborts', () => {
      const c1 = new AbortController();
      const c2 = new AbortController();
      const { signal, cleanup } = combineSignals(c1.signal, c2.signal);

      expect(signal.aborted).toBe(false);
      c2.abort('cancelled by c2');
      expect(signal.aborted).toBe(true);
      cleanup();
    });

    it('immediately aborts if an input signal was already aborted', () => {
      const c = new AbortController();
      c.abort('already aborted');
      const { signal } = combineSignals(c.signal);
      expect(signal.aborted).toBe(true);
    });
  });

  describe('sleep with cancellation', () => {
    it('aborts immediately when signal is triggered during sleep', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort('stop sleep'), 10);

      await expect(sleep(5000, controller.signal)).rejects.toThrow('stop sleep');
    });

    it('rejects immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort('immediate');

      await expect(sleep(1000, controller.signal)).rejects.toThrow('immediate');
    });
  });

  describe('ExplorerApiClient cancellation & timeout', () => {
    it('aborts inflight request when AbortSignal is cancelled by caller', async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();

      globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }) as any;

      try {
        const client = new ExplorerApiClient();
        const promise = client.get('/api/events', { signal: controller.signal });

        // Cancel after 10ms
        setTimeout(() => controller.abort('caller cancelled'), 10);

        await expect(promise).rejects.toThrow(/caller cancelled/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('aborts immediately without making network call if signal is already aborted', async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();
      controller.abort('pre-aborted');

      globalThis.fetch = vi.fn();

      try {
        const client = new ExplorerApiClient();
        await expect(client.get('/api/events', { signal: controller.signal })).rejects.toThrow('pre-aborted');
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('times out per-request and throws TimeoutError', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted', 'AbortError');
            reject(err);
          });
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({ timeout: 10_000 }); // Default 10s

        // Per-request timeout of 20ms
        const promise = client.get('/api/events', { timeout: 20 });

        await expect(promise).rejects.toThrow(TimeoutError);

        try {
          await client.get('/api/events', { timeout: 20 });
        } catch (err: any) {
          expect(err).toBeInstanceOf(TimeoutError);
          expect(err.code).toBe('ETIMEDOUT');
          expect(err.timeoutMs).toBe(20);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('per-request timeout overrides default client timeout', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({ timeout: 50 }); // Default 50ms

        // Override with per-request 10ms
        const start = Date.now();
        await expect(client.get('/api/events', { timeout: 10 })).rejects.toThrow(TimeoutError);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(45);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('cancels retry backoff sleep immediately when signal is aborted', async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();

      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'Server error' }), {
          status: 500,
          statusText: 'Internal Error',
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new ExplorerApiClient({
          retry: { maxRetries: 3, initialDelayMs: 2000, jitter: false },
        });

        const promise = client.get('/api/events', { signal: controller.signal });

        // Cancel during the 2000ms backoff sleep
        setTimeout(() => controller.abort('cancelled during backoff'), 50);

        const start = Date.now();
        await expect(promise).rejects.toThrow('cancelled during backoff');
        const elapsed = Date.now() - start;

        // Must abort immediately without waiting the full 2000ms
        expect(elapsed).toBeLessThan(500);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
