/**
 * @soroban-explorer/client
 *
 * Lightweight JavaScript client for the Soroban Smart Block Explorer API.
 * Works in Node.js 18+ and modern browsers.
 *
 * @example
 * ```js
 * import { createClient } from "@soroban-explorer/client";
 * const explorer = createClient({ baseUrl: "https://explorer.soroban.org" });
 * const events = await explorer.events({ contract: "CDA2...", limit: 5 });
 * ```
 */

/**
 * @typedef {object} ClientOptions
 * @property {string} [baseUrl="http://localhost:3001"] - Base URL of the explorer API.
 * @property {string} [apiKey] - API key for authenticated endpoints.
 * @property {(url: string, init?: RequestInit) => Promise<Response>} [fetch] -
 *   Custom fetch implementation (e.g. for Node.js where global fetch may not exist).
 */

/**
 * @typedef {object} DecodedEvent
 * @property {number} seq
 * @property {string} contract_id
 * @property {string} function
 * @property {number} ledger
 * @property {string} description
 * @property {string[]} raw_topics
 * @property {string} [tx_hash]
 * @property {number} [cpu_instructions]
 * @property {number} [mem_bytes]
 * @property {number} [fee_charged]
 * @property {boolean} [is_high_bloat_risk]
 * @property {boolean} [is_clawback]
 */

/**
 * @typedef {object} EventsPage
 * @property {DecodedEvent[]} data
 * @property {number|null} next_cursor
 */

/**
 * @typedef {object} EventsParams
 * @property {string} [contract]
 * @property {string} [fn]
 * @property {string} [type]
 * @property {number} [after_seq]
 * @property {number} [limit]
 */

/**
 * @typedef {object} SearchResult
 * @property {string} query
 * @property {object[]} contracts
 * @property {DecodedEvent[]} events
 * @property {object[]} wallets
 * @property {object[]} suggestions
 */

/**
 * @typedef {object} ContractMeta
 * @property {string} id
 * @property {number} version
 * @property {string} name
 * @property {string} description
 * @property {{name: string, description: string}[]} functions
 */

/**
 * @typedef {object} ContractsListResponse
 * @property {object[]} contracts
 * @property {object} pagination
 */

/**
 * @typedef {object} WalletResponse
 * @property {DecodedEvent[]} events
 */

/**
 * Create a Soroban Explorer API client.
 *
 * @param {ClientOptions} [opts]
 * @returns {ExplorerClient}
 */
export function createClient(opts = {}) {
  const baseUrl = opts.baseUrl ?? "http://localhost:3001";
  const apiKey = opts.apiKey;
  const customFetch = opts.fetch ?? fetch;
  const defaultTimeout = opts.timeout;
  const defaultRetry = opts.retry;

  /** @param {string} path @param {RequestInit & { timeout?: number, retry?: object|boolean, idempotent?: boolean }} [init] */
  async function request(path, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const timeoutMs = init.timeout ?? defaultTimeout;
    const effectiveRetry = init.retry !== undefined ? init.retry : defaultRetry;

    const retryPolicy =
      effectiveRetry === false
        ? null
        : typeof effectiveRetry === "object"
          ? {
              maxRetries: 3,
              initialDelayMs: 500,
              maxDelayMs: 10000,
              backoffFactor: 2,
              jitter: true,
              retryableStatusCodes: [408, 429, 500, 502, 503, 504],
              retryableMethods: ["GET", "HEAD", "OPTIONS"],
              ...effectiveRetry,
            }
          : effectiveRetry === true
            ? {
                maxRetries: 3,
                initialDelayMs: 500,
                maxDelayMs: 10000,
                backoffFactor: 2,
                jitter: true,
                retryableStatusCodes: [408, 429, 500, 502, 503, 504],
                retryableMethods: ["GET", "HEAD", "OPTIONS"],
              }
            : null;

    const canRetryMethod =
      Boolean(init.idempotent) ||
      (retryPolicy?.retryableMethods ?? ["GET", "HEAD", "OPTIONS"]).includes(method);
    const maxRetries = retryPolicy?.maxRetries ?? 0;

    let attempt = 0;
    while (true) {
      attempt++;

      if (init.signal?.aborted) {
        throw init.signal.reason ?? new Error("Request aborted");
      }

      let timer = null;
      let timeoutController;
      if (timeoutMs && timeoutMs > 0) {
        timeoutController = new AbortController();
        timer = setTimeout(() => {
          timeoutController?.abort(new Error(`Request timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      let compositeSignal = init.signal;
      let cleanupSignals = () => {};
      if (init.signal && timeoutController) {
        if (typeof AbortSignal.any === "function") {
          compositeSignal = AbortSignal.any([init.signal, timeoutController.signal]);
        } else {
          const comp = new AbortController();
          const onAbort = () => comp.abort();
          init.signal.addEventListener("abort", onAbort, { once: true });
          timeoutController.signal.addEventListener("abort", onAbort, { once: true });
          cleanupSignals = () => {
            init.signal?.removeEventListener("abort", onAbort);
            timeoutController?.signal.removeEventListener("abort", onAbort);
          };
          compositeSignal = comp.signal;
        }
      } else if (timeoutController) {
        compositeSignal = timeoutController.signal;
      }

      const headers = { ...init.headers };
      if (apiKey) headers["x-api-key"] = apiKey;
      if (!headers["Content-Type"] && init.method && init.method !== "GET") {
        headers["Content-Type"] = "application/json";
      }

      const url = `${baseUrl.replace(/\/+$/, "")}/api${path}`;
      let res;
      let networkError;

      try {
        res = await customFetch(url, { ...init, headers, signal: compositeSignal });
      } catch (err) {
        if (timer) clearTimeout(timer);
        cleanupSignals();
        if (init.signal?.aborted) throw init.signal.reason ?? err;
        if (timeoutController?.signal.aborted) throw timeoutController.signal.reason;
        networkError = err;
      } finally {
        if (timer) clearTimeout(timer);
        cleanupSignals();
      }

      if (res && res.ok) {
        const contentType = res.headers?.get?.("content-type") || "";
        if (contentType.includes("application/json") || typeof res.json === "function") {
          return typeof res.json === "function" ? res.json() : JSON.parse(await res.text());
        }
        return typeof res.text === "function" ? res.text() : String(res);
      }

      const status = res ? res.status : undefined;
      const retryCodes = retryPolicy?.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504];
      const isStatusRetryable = status !== undefined && retryCodes.includes(status);
      const isNetworkRetryable =
        networkError !== undefined &&
        !init.signal?.aborted &&
        !timeoutController?.signal.aborted;

      const shouldRetry =
        retryPolicy !== null &&
        canRetryMethod &&
        attempt <= maxRetries &&
        (isStatusRetryable || isNetworkRetryable);

      if (shouldRetry) {
        let delayMs =
          (retryPolicy.initialDelayMs ?? 500) *
          Math.pow(retryPolicy.backoffFactor ?? 2, attempt - 1);
        const retryAfterHeader = res?.headers?.get?.("Retry-After");
        if (retryAfterHeader) {
          const parsed = Number(retryAfterHeader);
          if (Number.isFinite(parsed) && parsed > 0) {
            delayMs = parsed * 1000;
          }
        }
        delayMs = Math.min(delayMs, retryPolicy.maxDelayMs ?? 10000);
        if (retryPolicy.jitter !== false) {
          delayMs = delayMs * (1 + Math.random() * 0.25);
        }

        if (retryPolicy.onRetry) {
          retryPolicy.onRetry({ attempt, delayMs, error: networkError, status });
        }

        await new Promise((resolve, reject) => {
          if (init.signal?.aborted) return reject(init.signal.reason ?? new Error("Request aborted"));
          const t = setTimeout(resolve, delayMs);
          init.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(init.signal?.reason ?? new Error("Request aborted"));
            },
            { once: true },
          );
        });

        continue;
      }

      if (networkError) {
        throw networkError;
      }

      const body = typeof res.text === "function" ? await res.text() : String(res);
      let message;
      try {
        const parsed = JSON.parse(body);
        message = parsed.error || body;
      } catch {
        message = body || `HTTP ${res.status}`;
      }
      throw new Error(message);
    }
  }

  return {
    /**
     * Fetch paginated events.
     * @param {EventsParams & { signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [params]
     * @returns {Promise<EventsPage>}
     */
    async events(params = {}) {
      const q = new URLSearchParams();
      if (params.contract) q.set("contract", params.contract);
      if (params.fn) q.set("fn", params.fn);
      if (params.type) q.set("type", params.type);
      if (params.cursor) q.set("cursor", params.cursor);
      if (params.after) q.set("after", String(params.after));
      if (params.before) q.set("before", params.before);
      if (params.after_seq) q.set("after_seq", String(params.after_seq));
      if (params.limit) q.set("limit", String(params.limit));
      if (params.count) q.set("count", params.count);
      return request(`/events?${q}`, {
        signal: params.signal,
        timeout: params.timeout,
        retry: params.retry,
      });
    },

    /**
     * Fetch a single event by sequence number.
     * @param {number} seq
     * @param {{ signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [opts]
     * @returns {Promise<DecodedEvent>}
     */
    async event(seq, opts = {}) {
      return request(`/events/${seq}`, opts);
    },

    /**
     * Search across contracts, events, and wallets.
     * @param {string} query
     * @param {number} [limit=10]
     * @param {{ signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [opts]
     * @returns {Promise<SearchResult>}
     */
    async search(query, limit = 10, opts = {}) {
      const q = new URLSearchParams();
      q.set("q", query);
      q.set("limit", String(limit));
      return request(`/search?${q}`, opts);
    },

    /**
     * Get contract metadata.
     * @param {string} id - Contract ID.
     * @param {{ signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [opts]
     * @returns {Promise<ContractMeta>}
     */
    async contract(id, opts = {}) {
      return request(`/contracts/${id}`, opts);
    },

    /**
     * List registered contracts.
     * @param {number} [page=1]
     * @param {number} [limit=25]
     * @param {{ signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [opts]
     * @returns {Promise<ContractsListResponse>}
     */
    async listContracts(page = 1, limit = 25, opts = {}) {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("limit", String(limit));
      return request(`/contracts?${q}`, opts);
    },

    /**
     * Get events for a wallet address.
     * @param {string} address - Stellar public key (starts with G).
     * @param {{ signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [opts]
     * @returns {Promise<WalletResponse>}
     */
    async wallet(address, opts = {}) {
      return request(`/wallet/${address}`, opts);
    },

    /**
     * Get aggregate stats.
     * @param {{ signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [opts]
     * @returns {Promise<{events: number, contracts: number}>}
     */
    async stats(opts = {}) {
      return request("/stats", opts);
    },

    /**
     * Get contract ABI JSON.
     * @param {string} id
     * @param {{ signal?: AbortSignal, timeout?: number, retry?: object|boolean }} [opts]
     * @returns {Promise<object>}
     */
    async contractAbi(id, opts = {}) {
      return request(`/contracts/${id}/abi`, opts);
    },
  };
}
