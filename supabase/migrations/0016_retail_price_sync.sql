-- Migration 0016: retail price sync tables, indexes, and chain seeds
-- Adds infrastructure for ingesting and tracking retail price data

-- 1. Add missing columns to shopping.refresh_log
ALTER TABLE shopping.refresh_log ADD COLUMN IF NOT EXISTS rows_changed integer;
ALTER TABLE shopping.refresh_log ADD COLUMN IF NOT EXISTS status text;

-- 2. Track which files have already been ingested (dedup by hash)
CREATE TABLE IF NOT EXISTS shopping.ingested_files (
  chain_code   text        NOT NULL,
  file_name    text        NOT NULL,
  sha256       text        NOT NULL,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_code, file_name)
);

-- 3. Staging area for incoming price data (UNLOGGED for write throughput)
--    PK on (chain_code, barcode) prevents cross-chain race conditions
CREATE UNLOGGED TABLE IF NOT EXISTS shopping.staging_prices (
  barcode      text           NOT NULL,
  chain_code   text           NOT NULL,
  item_name    text           NOT NULL,
  price        numeric(10,2)  NOT NULL,
  updated_at   timestamptz    NOT NULL,
  PRIMARY KEY (chain_code, barcode)
);
CREATE INDEX IF NOT EXISTS staging_prices_lookup
  ON shopping.staging_prices (barcode, chain_code);

-- 4. Append-only price change history
CREATE TABLE IF NOT EXISTS shopping.product_price_changes (
  id          bigserial     PRIMARY KEY,
  barcode     text          NOT NULL,
  chain_code  text          NOT NULL,
  old_price   numeric(10,2),
  new_price   numeric(10,2) NOT NULL,
  changed_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_price_changes_lookup
  ON shopping.product_price_changes (barcode, chain_code, changed_at DESC);

-- 5. Composite index on product_prices for fast chain+barcode lookups
CREATE INDEX IF NOT EXISTS product_prices_chain_barcode
  ON shopping.product_prices (chain_code, barcode);

-- 6. Disable realtime replication on high-write tables to reduce overhead
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS shopping.product_prices;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS shopping.product_price_changes;

-- 7. Seed the 6 new retail chains
INSERT INTO shopping.chains (code, display_name) VALUES
  ('mega',       'מגה'),
  ('rami_levy',  'רמי לוי'),
  ('victory',    'ויקטורי'),
  ('osher_ad',   'אושר עד'),
  ('hazi_hinam', 'חצי חינם'),
  ('yohananof',  'יוחננוף')
ON CONFLICT (code) DO NOTHING;
