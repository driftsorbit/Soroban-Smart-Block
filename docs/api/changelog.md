# API Changelog

All notable changes to the Soroban Smart Block Explorer HTTP and WebSocket API are
documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the API follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The machine-readable contract lives in [`openapi.json`](./openapi.json) (generated
from `indexer/openapi.yaml`). Try endpoints live in the
[Swagger playground](./playground.html) or the [try-it console](./try-it.html).

## [Unreleased]

### Added

- `GET /api/wallet/compare?a=&b=` — side-by-side activity summary for two public
  accounts over an optional `from`/`to` interval, with shared contracts and the
  event fields used (`fields_used`) disclosed (#1046).
- `GET /api/wallet/{address}/counterparties` — most-interacted contracts and
  counterparty addresses for a public account, each with `tx_hashes` and
  `event_seqs` for drill-down. Supports `from`/`to` and `limit` (1-50) (#1047).
- `POST /api/wallet/workspace` — summaries for 2-10 distinct public accounts in
  one response. The server stores no selection; responses are `no-store` (#1048).
- `POST /api/wallet/filter-presets/validate`, `/share`, and `/open` — validate an
  account activity filter preset, encode it as a versioned share token, and decode
  and re-validate a token. Presets are saved in the browser; the server stores
  none (#1049).
- This changelog and a generated OpenAPI 3.1 JSON document for tooling.
- `GET /api/tokens/{contractId}/nfts/analytics` and `GET /api/contracts/{id}/stats` support optional `as_of_ledger` parameter for point-in-time historical analytics, returning `as_of_ledger` and `watermark` metadata (#1070).
- `GET /api/events/{seq}/decode-provenance` and `decode_provenance` fields (`decoder`, `decoder_version`, `abi_version`, `decode_status`) added to decoded event REST responses (#1071).
- `GET /api/tx/{hash}/events` and `GET /api/transactions/{hash}/events` for bounded transaction events with deterministic `seq` ordering (#1072).
- `GET /api/contracts/{id}/activity-summary` for bounded per-contract event activity aggregated by function and interval (hour/day/week) with partial data indicators (#1073).
- `GET /api/contracts/{id}/stats` — event/caller counts and a daily activity
  series for a contract, cached for 5 minutes. Accepts an optional `range`
  query parameter (1-365 days, default 30) for the historical 30/90/365-day
  event-volume trend (#799).
- `GET /api/contracts/{id}/storage-tiers` — write counts grouped by storage
  durability tier (temporary, persistent, instance).
- `GET /api/assets/{issuer}/{code}` — classic Stellar asset metadata resolved
  via Horizon, cached for 24 hours.
- `GET /api/export/events` now supports optional `schedule=daily|weekly` and
  `email=` delivery metadata for recurring CSV exports.

## [v1.0.0]

### Added

- First formal API version and stable route contract for the public HTTP API.
- `GET /api/events`, `GET /api/contracts/:id`, and wallet export flows stabilized
  under the v1 compatibility promise.
- Documentation references now include a versioned changelog and policy for
  scheduled migration away from deprecated routes. See the
  [deprecation policy](./deprecation-policy.md) for full migration details.

### Changed

- API behavior documented as versioned and semver-scoped for future breaking
  releases.

## [0.1.0]

### Added

- **Events**
  - `GET /api/events` — list contract events with offset pagination and filters
    (`contract`, `fn`, `type`, `page`).
  - `GET /api/v1/events` — cursor-paginated event listing.
  - `GET /api/events/{seq}` — full decoded event detail.
  - `GET /api/events/{seq}/zk-costs` — zero-knowledge cost breakdown for an event.
- **Contracts**
  - `GET /api/contracts/{id}` — contract metadata and ABI registry entry.
  - `GET /api/contracts/{id}/build-metadata` — reproducible build metadata.
  - `GET /api/contracts/{id}/abi` — decoded ABI for a contract.
  - `GET /api/contracts/{id}/transactions` — transaction history for a contract.
  - `GET /api/contracts/{id}/upgrades` — upgrade history.
  - `GET /api/contracts/{id}/ttl` — time-to-live and archival status.
  - `GET /api/contracts/{id}/state-diffs` — per-invocation state diffs.
  - `GET /api/contracts/{id}/circuit-breaker` — circuit-breaker status.
  - `GET /api/contracts/{id}/migration-status` — migration status.
  - `GET /api/contracts/{id}/rwa-metadata` — real-world-asset metadata.
- **Wallets and tokens**
  - `GET /api/wallet/{address}` — wallet transaction history.
  - `GET /api/tokens/{id}/holders` — token holder distribution.
  - `GET /api/tokens/{id}/volume` — token volume over time.
- **Tools**
  - `GET /api/spec/{id}` — contract interface specification.
  - `POST /api/verify` — verify a contract against published source.
  - `POST /api/simulate` — simulate a contract invocation.
  - `POST /api/sandbox/simulate` — sandboxed simulation.
  - `GET /api/auth-tree` — authorization tree for an invocation.
  - `GET /api/burn-alerts` — token burn alerts.
  - `GET /api/rpc-metrics` — RPC node metrics.
  - `GET /api/rpc-nodes` — configured RPC nodes.
- **WebSocket**
  - Live event stream over `ws(s)://<host>/?api_key=<key>`. Messages have the
    shape `{ "type": "event" | "vault_ratio" | "contract_link", "data": ... }`.

### Security

- Optional API key enforcement via the `X-API-Key` header on HTTP requests and the
  `api_key` query parameter on WebSocket connections.
- Per-IP rate limiting on the HTTP API.

## Versioning policy

- **Patch** releases cover backward-compatible fixes and additive response fields.
- **Minor** releases add new endpoints or optional parameters without breaking
  existing clients.
- **Major** releases may remove or change existing endpoints. Breaking changes are
  introduced under a new path prefix (for example `/api/v2/...`) where practical so
  older clients keep working during migration.

[Unreleased]: https://github.com/Soroban-Smart-Block-Explorer/Soroban-Smart-Block/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Soroban-Smart-Block-Explorer/Soroban-Smart-Block/releases/tag/v0.1.0
