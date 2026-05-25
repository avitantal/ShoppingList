#!/usr/bin/env python3
"""
Emit batched UPSERT SQL from the NDJSON produced by fetch_shufersal_pricefull.py.

Usage:
    python scripts/emit_upsert_sql.py <NDJSON_PATH> <CHAIN_CODE> <BATCH_SIZE> <OUT_DIR>

Writes batch_0001.sql, batch_0002.sql, ... in OUT_DIR. Each batch upserts
into shopping.products AND shopping.product_prices via two statements
using jsonb_array_elements over a literal JSON array, so the SQL stays
parameter-free and apply-able via Supabase MCP execute_sql.
"""
from __future__ import annotations
import json
import os
import sys


def chunked(iterable, n):
    chunk = []
    for x in iterable:
        chunk.append(x)
        if len(chunk) == n:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def sql_for(rows: list[dict], chain_code: str) -> str:
    arr = json.dumps(rows, ensure_ascii=False)
    # Use a CTE so we read the JSON literal exactly once.
    return f"""
with src as (
  select * from jsonb_to_recordset($json${arr}$json$::jsonb) as t(
    barcode text, name text, unit_qty numeric, unit_measure text,
    manufacturer text, price numeric
  )
),
upsert_products as (
  insert into shopping.products (barcode, name, unit_qty, unit_measure, manufacturer, updated_at)
  select barcode, name, unit_qty, unit_measure, manufacturer, now()
    from src
  on conflict (barcode) do update set
    name         = excluded.name,
    unit_qty     = excluded.unit_qty,
    unit_measure = excluded.unit_measure,
    manufacturer = excluded.manufacturer,
    updated_at   = excluded.updated_at
  returning 1
),
upsert_prices as (
  insert into shopping.product_prices (barcode, chain_code, price, updated_at)
  select barcode, '{chain_code}', price, now()
    from src
  on conflict (barcode, chain_code) do update set
    price      = excluded.price,
    updated_at = excluded.updated_at
  returning 1
)
select
  (select count(*) from upsert_products) as products_n,
  (select count(*) from upsert_prices)   as prices_n;
""".strip()


def main() -> int:
    if len(sys.argv) != 5:
        print("usage: emit_upsert_sql.py <NDJSON> <CHAIN_CODE> <BATCH_SIZE> <OUT_DIR>", file=sys.stderr)
        return 2
    src, chain, batch_size, out_dir = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    os.makedirs(out_dir, exist_ok=True)

    with open(src, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    sys.stderr.write(f"loaded {len(rows):,} rows from {src}\n")

    for i, chunk in enumerate(chunked(rows, batch_size), start=1):
        path = os.path.join(out_dir, f"batch_{i:04d}.sql")
        with open(path, "w", encoding="utf-8") as o:
            o.write(sql_for(chunk, chain))
    sys.stderr.write(f"wrote {(len(rows) + batch_size - 1) // batch_size} batch files into {out_dir}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
