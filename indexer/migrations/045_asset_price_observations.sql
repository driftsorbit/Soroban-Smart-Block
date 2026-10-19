-- Migration 045 (issue #1068): market-data price observations for classic
-- assets. Rows are appended by the price feed; readers pick the latest one and
-- classify its freshness (see src/marketPrice.js).

CREATE TABLE IF NOT EXISTS asset_price_observations (
  code        TEXT NOT NULL,
  issuer      TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  price       NUMERIC,
  source      TEXT,
  PRIMARY KEY (code, issuer, observed_at)
);
