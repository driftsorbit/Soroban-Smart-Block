-- Migration: Create sandbox scenario collections table
-- Allows users to organize, persist, import and export reusable named contract-call scenario collections

CREATE TABLE IF NOT EXISTS sandbox_scenario_collections (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  scenarios JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_scenario_collections_updated ON sandbox_scenario_collections (updated_at DESC);
