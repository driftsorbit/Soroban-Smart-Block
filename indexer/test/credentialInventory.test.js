import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db.js";
import { listKeys, getKeyById, deleteKey, rotateKey } from "../src/admin/keyManager.js";

describe("Per-Key API Credential Inventory and Revocation Timestamps (#1122)", () => {
  let originalQuery;
  let originalConnect;

  beforeEach(() => {
    originalQuery = pool.query;
    originalConnect = pool.connect;
  });

  function restore() {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }

  it("listKeys: returns least-privilege credential inventory without key_hash", async () => {
    pool.query = async (sql) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ total: 1 }] };
      }
      return {
        rows: [
          {
            id: "key-uuid-1",
            name: "Events Consumer",
            key_prefix: "sb_live_",
            tier: "free",
            rate_limit: 300,
            daily_limit: 1000,
            allowed_ips: null,
            allowed_endpoints: ["/api/events"],
            expires_at: null,
            scopes: ["read:events"],
            allowed_contract_ids: ["CA3D5KRYMCMZ2ANU77PFJIYWVCQO4UN2PD5CQ"],
            allowed_origins: ["https://dapp.example.com"],
            revoked: false,
            revoked_at: null,
            last_used_at: "2026-10-18T09:00:00Z",
            usage_count: 42,
            created_at: "2026-10-10T12:00:00Z",
            updated_at: "2026-10-18T09:00:00Z",
          },
        ],
      };
    };

    try {
      const result = await listKeys(1, 10);
      assert.equal(result.total, 1);
      assert.equal(result.data.length, 1);

      const key = result.data[0];
      assert.equal(key.name, "Events Consumer");
      assert.equal(key.key_prefix, "sb_live_");
      assert.deepEqual(key.scopes, ["read:events"]);
      assert.deepEqual(key.allowed_contract_ids, ["CA3D5KRYMCMZ2ANU77PFJIYWVCQO4UN2PD5CQ"]);
      assert.deepEqual(key.allowed_origins, ["https://dapp.example.com"]);
      assert.equal(key.created_at, "2026-10-10T12:00:00Z");
      assert.equal(key.last_used_at, "2026-10-18T09:00:00Z");
      assert.equal(key.revoked, false);
      assert.equal(key.revoked_at, null);

      // Security requirement: Never expose stored key secrets or hashes
      assert.equal(key.key_hash, undefined);
      assert.equal(key.secret, undefined);
    } finally {
      restore();
    }
  });

  it("deleteKey: sets revoked = true and revoked_at timestamp", async () => {
    let capturedSql;
    let capturedParams;

    pool.query = async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            name: "Revoked Key",
            key_prefix: "sb_live_",
            tier: "free",
            revoked: true,
            revoked_at: "2026-10-18T10:00:00Z",
            last_used_at: null,
            created_at: "2026-10-01T00:00:00Z",
            updated_at: "2026-10-18T10:00:00Z",
          },
        ],
      };
    };

    try {
      const revoked = await deleteKey("target-key-id");
      assert.ok(capturedSql.includes("SET revoked = TRUE"));
      assert.ok(capturedSql.includes("revoked_at = NOW()"));
      assert.equal(capturedParams[0], "target-key-id");
      assert.equal(revoked.revoked, true);
      assert.equal(revoked.revoked_at, "2026-10-18T10:00:00Z");
      assert.equal(revoked.key_hash, undefined);
    } finally {
      restore();
    }
  });

  it("rotateKey: revokes old key with revoked_at timestamp", async () => {
    let capturedUpdateSql;

    const mockClient = {
      query: async (sql, _params) => {
        if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT")) return {};
        if (sql.includes("SELECT name")) {
          return {
            rows: [
              {
                name: "Rotated Key",
                email: "dev@example.com",
                tier: "free",
                rate_limit: 100,
                daily_limit: 1000,
                allowed_ips: null,
                allowed_endpoints: null,
                expires_at: null,
                verified: true,
              },
            ],
          };
        }
        if (sql.includes("INSERT INTO api_keys")) {
          return {
            rows: [
              {
                id: "new-key-id",
                name: "Rotated Key",
                email: "dev@example.com",
                key_prefix: "newpref_",
                tier: "free",
                scopes: ["read:events"],
                revoked: false,
                revoked_at: null,
                last_used_at: null,
                created_at: "2026-10-18T10:05:00Z",
                updated_at: "2026-10-18T10:05:00Z",
              },
            ],
          };
        }
        if (sql.includes("UPDATE api_keys") && sql.includes("SET revoked = TRUE")) {
          capturedUpdateSql = sql;
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    try {
      const result = await rotateKey("old-key-id");
      assert.ok(result.key);
      assert.equal(result.record.id, "new-key-id");
      assert.equal(result.record.revoked, false);
      assert.equal(result.record.revoked_at, null);

      assert.ok(capturedUpdateSql.includes("SET revoked = TRUE"));
      assert.ok(capturedUpdateSql.includes("revoked_at = NOW()"));
      assert.ok(capturedUpdateSql.includes("rotated_at = NOW()"));
    } finally {
      restore();
    }
  });

  it("getKeyById: includes scopes, last_used_at, and revoked_at without secrets", async () => {
    pool.query = async () => ({
      rows: [
        {
          id: "uuid-123",
          name: "Read-only Key",
          email: "owner@example.com",
          key_prefix: "sb_live_",
          tier: "pro",
          scopes: ["read:events", "read:contracts"],
          revoked: true,
          revoked_at: "2026-10-15T08:30:00Z",
          last_used_at: "2026-10-14T20:00:00Z",
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-15T08:30:00Z",
        },
      ],
    });

    try {
      const record = await getKeyById("uuid-123");
      assert.equal(record.id, "uuid-123");
      assert.deepEqual(record.scopes, ["read:events", "read:contracts"]);
      assert.equal(record.revoked, true);
      assert.equal(record.revoked_at, "2026-10-15T08:30:00Z");
      assert.equal(record.last_used_at, "2026-10-14T20:00:00Z");
      assert.equal(record.key_hash, undefined);
    } finally {
      restore();
    }
  });
});
