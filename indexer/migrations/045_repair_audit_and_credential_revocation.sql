-- Migration 045: Audit trail for manual repair/replay jobs (#1118)
-- and revocation timestamps for API credentials (#1122).

-- 1. Repair and replay audit trail
CREATE TABLE IF NOT EXISTS repair_audit_trail (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL DEFAULT 'replay',
  actor TEXT NOT NULL,
  range_from BIGINT NOT NULL,
  range_to BIGINT NOT NULL,
  reason TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_repair_audit_created ON repair_audit_trail(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_audit_status ON repair_audit_trail(status);
CREATE INDEX IF NOT EXISTS idx_repair_audit_actor ON repair_audit_trail(actor);

-- 2. Credential inventory revocation timestamp
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
