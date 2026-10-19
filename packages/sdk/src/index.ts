/**
 * Soroban Smart Block Explorer TypeScript SDK
 *
 * Fetch wrapper for consuming the Soroban Smart Block Explorer API with
 * configurable retry/backoff policies (#1082), request cancellation/timeouts (#1083),
 * typed webhook verification (#1084), and ABI event decoding (#1085).
 */

import {
  RetryPolicy,
  DEFAULT_RETRY_POLICY,
  calculateBackoffDelay,
  isRetryableMethod,
  isRetryableStatus,
  isRetryableNetworkError,
  combineSignals,
  sleep,
  TimeoutError,
} from './retry.js';

export interface ClientConfig {
  baseUrl?: string;
  apiKey?: string;
  bearerToken?: string;
  csrfToken?: string;
  timeout?: number;
  headers?: Record<string, string>;
  /** Global retry policy. Set to false to disable retries. */
  retry?: RetryPolicy | boolean;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  /** Per-request timeout in milliseconds (overrides client default). */
  timeout?: number;
  /** Explicit cancellation signal. */
  signal?: AbortSignal;
  /** Per-request retry policy or false to disable retries. */
  retry?: RetryPolicy | boolean;
  /** Explicit flag indicating this request is safe/idempotent to retry. */
  idempotent?: boolean;
}

export interface ResponseMetadata {
  status: number;
  statusText: string;
  headers: Headers;
  rateLimitLimit?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
  rateLimitTier?: string;
}

/**
 * Combine a caller-supplied signal with the client timeout so cancellation
 * does not silently disable the timeout (and vice versa).
 */
function withTimeout(userSignal: AbortSignal | null | undefined, ms: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(ms);
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  if (userSignal.aborted) {
    controller.abort(userSignal.reason);
  } else {
    userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), { once: true });
  }
  timeoutSignal.addEventListener('abort', () => controller.abort(timeoutSignal.reason), { once: true });
  return controller.signal;
}

export { signRequest } from "./signing.js";
export type { SignRequestInput } from "./signing.js";

export * from './verify.js';
export * from './signing.js';
export * from './webhook.js';
export * from './retry.js';
export * from './events.js';

export class ExplorerApiClient {
  private baseUrl: string;
  private apiKey?: string;
  private bearerToken?: string;
  private csrfToken?: string;
  private timeout: number;
  private defaultHeaders: Record<string, string>;
  private defaultRetry?: RetryPolicy | boolean;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:3001';
    this.apiKey = config.apiKey;
    this.bearerToken = config.bearerToken;
    this.csrfToken = config.csrfToken;
    this.timeout = config.timeout ?? 30000;
    this.defaultRetry = config.retry;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  /**
   * Fetch a CSRF token from the server.
   * Must be called before making state-changing requests (POST/PATCH/DELETE).
   */
  async fetchCsrfToken(): Promise<{ csrfToken: string }> {
    const response = await this.request<{ csrfToken: string }>('GET', '/api/csrf-token', {
      credentials: 'include',
    });
    this.csrfToken = response.data.csrfToken;
    return response.data;
  }

  /**
   * Make an HTTP request to the API with retry, timeout, and cancellation support.
   */
  async request<T>(
    method: string,
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const { params, signal, ...rest } = options;
    const url = this.buildUrl(endpoint, params);
    const headers = this.buildHeaders(method);
    const timeoutMs = options.timeout ?? this.timeout;

    // Resolve retry policy
    const effectiveRetry = options.retry !== undefined ? options.retry : this.defaultRetry;
    const retryPolicy: RetryPolicy =
      effectiveRetry === false
        ? { maxRetries: 0 }
        : typeof effectiveRetry === 'object'
          ? { ...DEFAULT_RETRY_POLICY, ...effectiveRetry }
          : effectiveRetry === true
            ? { ...DEFAULT_RETRY_POLICY }
            : { ...DEFAULT_RETRY_POLICY };

    const maxRetries = retryPolicy.maxRetries ?? 0;
    const canRetryMethod = isRetryableMethod(method, retryPolicy, options.idempotent);

    let attempt = 0;

    while (true) {
      attempt++;

      // Abort early if user signal is already aborted
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new Error('Request cancelled');
      }

      let timeoutController: AbortController | undefined;
      let timer: any = null;

      if (timeoutMs > 0) {
        timeoutController = new AbortController();
        timer = setTimeout(() => {
          timeoutController?.abort(new TimeoutError(timeoutMs));
        }, timeoutMs);
      }

      const { signal, cleanup } = combineSignals(options.signal, timeoutController?.signal);

      const fetchOptions: RequestInit = {
        method,
        headers,
        signal,
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
      };

      let response: Response | undefined;
      let networkError: Error | undefined;

      try {
        response = await fetch(url, fetchOptions);
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        cleanup();

        if (options.signal?.aborted) {
          throw options.signal.reason ?? err;
        }

        if (timeoutController?.signal.aborted) {
          const reason = timeoutController.signal.reason;
          if (reason instanceof TimeoutError) throw reason;
          throw new TimeoutError(timeoutMs);
        }

        if (err instanceof Error && err.name === 'AbortError') {
          if (options.signal?.aborted) throw options.signal.reason ?? err;
          throw new TimeoutError(timeoutMs);
        }

        networkError = err;
      } finally {
        if (timer) clearTimeout(timer);
        cleanup();
      }

      if (response && response.ok) {
        const data = await this.parseResponse<T>(response);
        const meta = this.extractMetadata(response);
        return { data, meta };
      }

      // Check whether this failure can be retried
      const status = response ? response.status : undefined;
      const isRetryableOutcome =
        canRetryMethod &&
        attempt <= maxRetries &&
        !options.signal?.aborted &&
        ((response && isRetryableStatus(status!, retryPolicy)) ||
          (networkError && isRetryableNetworkError(networkError)));

      let shouldRetry = isRetryableOutcome;
      if (shouldRetry && retryPolicy.shouldRetry) {
        shouldRetry = retryPolicy.shouldRetry({
          attempt,
          maxRetries,
          method,
          url,
          error: networkError,
          status,
          delayMs: 0,
          retryAfterHeader: response?.headers.get('Retry-After'),
        });
      }

      if (shouldRetry) {
        const retryAfter = response?.headers.get('Retry-After');
        const delayMs = calculateBackoffDelay(attempt, retryPolicy, retryAfter);

        if (retryPolicy.onRetry) {
          retryPolicy.onRetry({
            attempt,
            maxRetries,
            method,
            url,
            error: networkError,
            status,
            delayMs,
            retryAfterHeader: retryAfter,
          });
        }

        try {
          await sleep(delayMs, options.signal);
        } catch (sleepErr) {
          if (options.signal?.aborted) {
            throw options.signal.reason ?? sleepErr;
          }
          throw sleepErr;
        }

        continue;
      }

      // Cannot retry — raise final error
      if (networkError) {
        if (networkError instanceof TypeError && networkError.message.includes('Failed to fetch')) {
          throw new Error(`Network error: ${networkError.message}`);
        }
        throw networkError;
      }

      const data = await this.parseResponse<T>(response!);
      const meta = this.extractMetadata(response!);
      throw new ApiError(response!.status, response!.statusText, data, meta);
    }
  }

  /**
   * Iterate events with automatic cursor pagination (#1080).
   *
   * Returns a lazy, cancellable async iterator that follows `next_cursor`
   * across pages. See `IterateEventsOptions` for filters, page size, bounds
   * and cancellation.
   *
   * ```ts
   * for await (const event of client.iterateEvents({ contract: 'C...', limit: 100 })) {
   *   // ...
   * }
   * ```
   */
  iterateEvents<T = EventRecord>(
    options: IterateEventsOptions = {},
  ): EventIterator<T> {
    return createEventIterator<T>(this, options, '/api/events');
  }

  /**
   * GET request helper.
   */
  async get<T>(
    endpoint: string,
    options: Omit<RequestOptions, 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>('GET', endpoint, options);
  }

  /**
   * POST request helper.
   */
  async post<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<RequestOptions, 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', endpoint, { ...options, body });
  }

  /**
   * PATCH request helper.
   */
  async patch<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<RequestOptions, 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', endpoint, { ...options, body });
  }

  /**
   * DELETE request helper.
   */
  async delete<T>(
    endpoint: string,
    options: Omit<RequestOptions, 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', endpoint, options);
  }

  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(endpoint, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  private buildHeaders(method: string): Headers {
    const headers = new Headers(this.defaultHeaders);

    if (this.apiKey) {
      headers.set('X-API-Key', this.apiKey);
    }

    if (this.bearerToken) {
      headers.set('Authorization', `Bearer ${this.bearerToken}`);
    }

    if (['POST', 'PATCH', 'DELETE'].includes(method.toUpperCase()) && this.csrfToken) {
      headers.set('X-CSRF-Token', this.csrfToken);
    }

    return headers;
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        return (await response.json()) as T;
      } catch {
        throw new Error('Failed to parse JSON response');
      }
    }
    return (await response.text()) as unknown as T;
  }

  private extractMetadata(response: Response): ResponseMetadata {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      rateLimitLimit: this.parseHeaderAsNumber(response.headers.get('X-RateLimit-Limit')),
      rateLimitRemaining: this.parseHeaderAsNumber(response.headers.get('X-RateLimit-Remaining')),
      rateLimitReset: this.parseHeaderAsNumber(response.headers.get('X-RateLimit-Reset')),
      rateLimitTier: response.headers.get('X-RateLimit-Tier') || undefined,
    };
  }

  private parseHeaderAsNumber(value: string | null): number | undefined {
    if (!value) return undefined;
    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setBearerToken(token: string): void {
    this.bearerToken = token;
  }

  setCsrfToken(token: string): void {
    this.csrfToken = token;
  }

  setRetryPolicy(retry?: RetryPolicy | boolean): void {
    this.defaultRetry = retry;
  }
}

// NOTE: The `ApiError` class (and its typed subclasses) now live in
// `errors.ts` and are re-exported above for backwards compatibility.

/**
 * Create a default client instance.
 */
export function createClient(config?: ClientConfig): ExplorerApiClient {
  return new ExplorerApiClient(config);
}

export default ExplorerApiClient;
