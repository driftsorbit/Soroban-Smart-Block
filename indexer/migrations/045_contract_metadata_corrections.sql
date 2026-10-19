-- Issue #1059 — append-only log of attributable metadata corrections.
-- Each row records one corrected field, the value it replaced, the reason and
-- the API key that made the change. Prior rows in contract_versions are never
-- rewritten; this table is the audit trail for changes made to live metadata.
CREATE TABLE IF NOT EXISTS contract_metadata_corrections (
  id          BIGSERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  field       TEXT NOT NULL CHECK (field IN ('name', 'description')),
  old_value   TEXT,
  new_value   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metadata_corrections_contract
  ON contract_metadata_corrections(contract_id, created_at DESC);
