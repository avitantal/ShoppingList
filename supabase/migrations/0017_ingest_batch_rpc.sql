-- supabase/migrations/0017_ingest_batch_rpc.sql
CREATE OR REPLACE FUNCTION shopping.ingest_batch(
  p_chain_code text,
  p_file_name  text,
  p_sha256     text,
  p_rows       jsonb,
  p_is_final   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = shopping
AS $$
DECLARE
  v_upserted integer := 0;
  v_changed  integer := 0;
BEGIN
  -- Skip if this file was already fully ingested
  IF EXISTS (
    SELECT 1 FROM shopping.ingested_files
    WHERE chain_code = p_chain_code AND file_name = p_file_name
  ) THEN
    RETURN jsonb_build_object('status', 'already_ingested');
  END IF;

  -- Stage this batch (ON CONFLICT = last-write-wins within a file)
  INSERT INTO shopping.staging_prices (barcode, chain_code, item_name, price, updated_at)
  SELECT
    r->>'barcode',
    p_chain_code,
    r->>'item_name',
    (r->>'price')::numeric(10,2),
    (r->>'updated_at')::timestamptz
  FROM jsonb_array_elements(p_rows) AS r
  WHERE (r->>'barcode') IS NOT NULL
    AND (r->>'item_name') <> ''
    AND (r->>'price')::numeric > 0
  ON CONFLICT (chain_code, barcode) DO UPDATE
    SET item_name  = EXCLUDED.item_name,
        price      = EXCLUDED.price,
        updated_at = EXCLUDED.updated_at;

  -- Intermediate batches: just stage, don't merge yet
  IF NOT p_is_final THEN
    RETURN jsonb_build_object('status', 'staged', 'batch_rows', jsonb_array_length(p_rows));
  END IF;

  -- === Final batch: merge staged data into production tables ===

  -- Count total rows being processed
  SELECT COUNT(*) INTO v_upserted
  FROM shopping.staging_prices
  WHERE chain_code = p_chain_code;

  -- Upsert products (DO NOTHING = preserve richer existing data)
  INSERT INTO shopping.products (barcode, name)
  SELECT DISTINCT barcode, item_name
  FROM shopping.staging_prices
  WHERE chain_code = p_chain_code
  ON CONFLICT (barcode) DO NOTHING;

  -- Capture price deltas BEFORE updating product_prices
  INSERT INTO shopping.product_price_changes (barcode, chain_code, old_price, new_price)
  SELECT s.barcode, s.chain_code, pp.price AS old_price, s.price AS new_price
  FROM shopping.staging_prices s
  JOIN shopping.product_prices pp ON pp.barcode = s.barcode AND pp.chain_code = s.chain_code
  WHERE s.chain_code = p_chain_code
    AND pp.price IS DISTINCT FROM s.price;

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  -- Upsert current prices
  INSERT INTO shopping.product_prices (barcode, chain_code, price, updated_at)
  SELECT barcode, chain_code, price, updated_at
  FROM shopping.staging_prices
  WHERE chain_code = p_chain_code
  ON CONFLICT (barcode, chain_code) DO UPDATE
    SET price      = EXCLUDED.price,
        updated_at = EXCLUDED.updated_at;

  -- Record file as done (dedup key)
  INSERT INTO shopping.ingested_files (chain_code, file_name, sha256)
  VALUES (p_chain_code, p_file_name, p_sha256)
  ON CONFLICT (chain_code, file_name) DO NOTHING;

  -- Clean staging for this chain only (safe with parallel chains)
  DELETE FROM shopping.staging_prices WHERE chain_code = p_chain_code;

  -- Write heartbeat to refresh_log
  INSERT INTO shopping.refresh_log (chain_code, status, rows_upserted, rows_changed)
  VALUES (p_chain_code, 'success', v_upserted, v_changed);

  RETURN jsonb_build_object('status', 'ok', 'upserted', v_upserted, 'changed', v_changed);
END;
$$;

GRANT EXECUTE ON FUNCTION shopping.ingest_batch TO service_role;
