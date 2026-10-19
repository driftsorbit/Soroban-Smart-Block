/**
 * Shared SDK types.
 *
 * Kept in their own module so error handling (`errors.ts`) and pagination
 * (`events.ts`) can import them without pulling in `index.ts` and creating a
 * circular dependency at runtime.
 */

export interface ClientConfig {
  baseUrl?: string;
  apiKey?: string;
  bearerToken?: string;
  csrfToken?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'signal'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  /**
   * Cancels the request. Combined with the client-level timeout rather than
   * replacing it, so an un-cancelled request still honours the timeout.
   */
  signal?: AbortSignal;
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

export interface ApiResponse<T> {
  data: T;
  meta: ResponseMetadata;
}
