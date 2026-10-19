import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "../src/db.js";

describe("Repair and Replay Audit Trail (#1118)", () => {
  let originalQuery;

  beforeEach(() => {
    originalQuery = pool.query;
  });

  function restorePool() {
    pool.query = originalQuery;
  }

  it("recordRepairAudit: records actor, range, reason, dry-run, status, and completion", async () => {
    let capturedSql;
    let capturedParams;

    pool.query = async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: 1,
            action: params[0],
            actor: params[1],
            range_from: params[2],
            range_to: params[3],
            reason: params[4],
            dry_run: params[5],
            status: params[6],
            details: JSON.parse(params[7]),
            created_at: new Date().toISOString(),
            completed_at: params[8],
          },
        ],
      };
    };

    try {
      const record = await db.recordRepairAudit({
        action: "replay",
        actor: "admin_user",
        range_from: 1000,
        range_to: 1050,
        reason: "Recover ledger gap after RPC reconnect",
        dry_run: false,
        status: "running",
        details: { scanned_events: 50 },
        completed_at: null,
      });

      assert.ok(capturedSql.includes("INSERT INTO repair_audit_trail"));
      assert.ok(capturedParams && capturedParams.length > 0);
      assert.equal(record.id, 1);
      assert.equal(record.action, "replay");
      assert.equal(record.actor, "admin_user");
      assert.equal(record.range_from, 1000);
      assert.equal(record.range_to, 1050);
      assert.equal(record.reason, "Recover ledger gap after RPC reconnect");
      assert.equal(record.dry_run, false);
      assert.equal(record.status, "running");
      assert.deepEqual(record.details, { scanned_events: 50 });
      assert.equal(record.completed_at, null);
    } finally {
      restorePool();
    }
  });

  it("recordRepairAudit: records dry-run simulations with completed status and completion timestamp", async () => {
    pool.query = async (_sql, params) => {
      return {
        rows: [
          {
            id: 2,
            action: params[0],
            actor: params[1],
            range_from: params[2],
            range_to: params[3],
            reason: params[4],
            dry_run: params[5],
            status: params[6],
            details: JSON.parse(params[7]),
            created_at: new Date().toISOString(),
            completed_at: params[8],
          },
        ],
      };
    };

    try {
      const completedAt = new Date().toISOString();
      const record = await db.recordRepairAudit({
        action: "repair_range",
        actor: "admin_tester",
        range_from: 200,
        range_to: 300,
        reason: "Test dry-run simulation",
        dry_run: true,
        status: "completed",
        details: { simulated: true },
        completed_at: completedAt,
      });

      assert.equal(record.dry_run, true);
      assert.equal(record.status, "completed");
      assert.equal(record.completed_at, completedAt);
    } finally {
      restorePool();
    }
  });

  it("updateRepairAudit: updates status, details, and completion timestamp", async () => {
    let capturedSql;
    let capturedParams;

    pool.query = async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: params.at(-1),
            status: params[0],
            details: JSON.parse(params[1]),
            completed_at: params[2],
          },
        ],
      };
    };

    try {
      const completionTime = new Date().toISOString();
      const updated = await db.updateRepairAudit(1, {
        status: "completed",
        details: { rows_repaired: 42 },
        completed_at: completionTime,
      });

      assert.ok(capturedSql.includes("UPDATE repair_audit_trail SET"));
      assert.ok(capturedParams && capturedParams.length > 0);
      assert.equal(updated.status, "completed");
      assert.deepEqual(updated.details, { rows_repaired: 42 });
      assert.equal(updated.completed_at, completionTime);
    } finally {
      restorePool();
    }
  });

  it("listRepairAudit: handles empty results and filters", async () => {
    pool.query = async (sql) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ total: 0 }] };
      }
      return { rows: [] };
    };

    try {
      const result = await db.listRepairAudit({
        status: "completed",
        actor: "admin",
        dry_run: true,
        limit: 10,
        offset: 0,
      });

      assert.deepEqual(result.data, []);
      assert.equal(result.total, 0);
      assert.equal(result.limit, 10);
      assert.equal(result.offset, 0);
    } finally {
      restorePool();
    }
  });

  it("getRepairAuditById: returns null when not found", async () => {
    pool.query = async () => ({ rows: [] });

    try {
      const result = await db.getRepairAuditById(99999);
      assert.equal(result, null);
    } finally {
      restorePool();
    }
  });
});
