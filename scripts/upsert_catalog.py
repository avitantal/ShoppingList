#!/usr/bin/env python3
"""
Upsert normalized product rows (from fetch_shufersal_pricefull.py's NDJSON)
into shopping.products + shopping.product_prices via Supabase's PostgREST API.

Auth: reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
The service role key bypasses RLS — required to write to the catalog
tables, whose RLS only grants SELECT to authenticated users.

Usage:
    python scripts/upsert_catalog.py <NDJSON_PATH> <CHAIN_CODE> [BATCH_SIZE]

Defaults: BATCH_SIZE=500.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request
import urllib.error


def load_env() -> tuple[str, str]:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    url = key = None
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k == "VITE_SUPABASE_URL" or k == "SUPABASE_URL":
                url = v
            elif k == "SUPABASE_SERVICE_ROLE_KEY":
                key = v
    if not url or not key:
        raise SystemExit("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
    return url, key


def post(url: str, key: str, path: str, payload: list[dict], on_conflict: str) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}?on_conflict={on_conflict}",
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept-Profile": "shopping",
            "Content-Profile": "shopping",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"HTTP {e.code} on {path}: {e.read().decode('utf-8', errors='replace')[:500]}\n")
        raise


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: upsert_catalog.py <NDJSON> <CHAIN_CODE> [BATCH_SIZE]", file=sys.stderr)
        return 2

    src, chain = sys.argv[1], sys.argv[2]
    batch_size = int(sys.argv[3]) if len(sys.argv) > 3 else 500

    url, key = load_env()
    sys.stderr.write(f"target: {url}\n")

    with open(src, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    sys.stderr.write(f"loaded {len(rows):,} rows\n")

    products_total = prices_total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        products_payload = [
            {
                "barcode": r["barcode"],
                "name": r["name"],
                "unit_qty": r["unit_qty"],
                "unit_measure": r["unit_measure"],
                "manufacturer": r["manufacturer"],
            }
            for r in chunk
        ]
        prices_payload = [
            {"barcode": r["barcode"], "chain_code": chain, "price": r["price"]}
            for r in chunk
        ]
        post(url, key, "products", products_payload, "barcode")
        post(url, key, "product_prices", prices_payload, "barcode,chain_code")
        products_total += len(chunk)
        prices_total += len(chunk)
        sys.stderr.write(f"  upserted {products_total:,}/{len(rows):,}\n")

    sys.stderr.write(f"done: products={products_total} prices={prices_total}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
