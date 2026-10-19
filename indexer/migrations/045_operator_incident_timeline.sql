-- Migration 045: Operator incident timeline for indexer events
-- Correlates deployments, provider changes, lag spikes, and recovery actions (closes #1115).

CREATE TABLE IF NOT EXISTS operator_incident_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'info',
  source VARCHAR(64) NOT NULL DEFAULT 'indexer',
  summary TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_incident_events_created_at ON operator_incident_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_incident_events_event_type ON operator_incident_events (event_type);
CREATE INDEX IF NOT EXISTS idx_operator_incident_events_severity ON operator_incident_events (severity);
