# Optional / Experimental Modules

These modules are optional or experimental features that require additional infrastructure or deliberate configuration.

| File | What it does | Requires |
|---|---|---|
| `leaderElection.js` | Redis distributed leader election for multi-instance deployments; already wired into the daemon | Set the same `REDIS_URL` and `LEADER_ELECTION_KEY` on every replica |
| `rpcProviderPool.js` | Weighted RPC provider pool with sliding-window health scoring and automatic failover | Multiple `SOROBAN_RPC_URLS` configured |

## How to enable

Each module exports a self-contained API. Activate optional modules by importing them from `../index.js` or the appropriate module and following the configuration instructions in the file header.

When `REDIS_URL` is configured, only the replica holding the Redis lease polls and processes ledger events; other replicas continue serving the API. For multi-replica deployments, all indexers must share the same Redis URL and leader key.

## Historical backfill

Reprocess an inclusive ledger range without moving the daemon cursor:

```sh
cd indexer
npm run backfill -- --from 500000 --to 510000
```

RPC pages are paced by `BACKFILL_PAGE_DELAY_MS` (default 250 ms, minimum 100 ms). Override the delay for a run with `--delay-ms`. Failed RPC requests use the indexer's retry policy, and a failed backfill exits non-zero so the range can be safely rerun.
