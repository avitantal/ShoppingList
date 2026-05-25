#!/usr/bin/env python3
"""
One-shot seed of shopping.products + product_prices via the temporary
`shopping._seed_catalog(secret, chain, payload)` SECURITY DEFINER RPC.

The RPC + this script exist only for the initial Shufersal seed; both
are dropped after success. Uses the anon key (VITE_SUPABASE_ANON_KEY)
because the RPC has been granted to anon and verifies the shared secret
internally.

Usage:
    python scripts/seed_via_temp_rpc.py <NDJSON_PATH> <CHAIN_CODE> [BATCH_SIZE]
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request
import urllib.error


SECRET = "seed-pivot-2026-05-25"


def load_env() -> tuple[str, str]:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    url = anon = None
    with open(env_path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if not v:
                continue
            if k == "VITE_SUPABASE_URL":
                url = v
            elif k == "VITE_SUPABASE_ANON_KEY":
                anon = v
    if not url or not anon:
        raise SystemExit("missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local")
    return url, anon


def call_rpc(url: str, key: str, chain: str, payload: list[dict]) -> tuple[int, int]:
    body = json.dumps({
        "p_secret": SECRET,
        "p_chain_code": chain,
        "p_payload": payload,
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/rpc/_seed_catalog",
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept-Profile": "shopping",
            "Content-Profile": "shopping",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:500]}\n")
        raise
    # RPC returns table -> array of rows. Take the single row.
    row = data[0] if isinstance(data, list) and data else data
    return row.get("products_n", 0), row.get("prices_n", 0)


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: seed_via_temp_rpc.py <NDJSON> <CHAIN_CODE> [BATCH_SIZE]", file=sys.stderr)
        return 2
    src, chain = sys.argv[1], sys.argv[2]
    batch_size = int(sys.argv[3]) if len(sys.argv) > 3 else 500

    url, anon = load_env()
    sys.stderr.write(f"target: {url}\n")

    with open(src, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    sys.stderr.write(f"loaded {len(rows):,} rows\n")

    p_total = pp_total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        p, pp = call_rpc(url, anon, chain, chunk)
        p_total += p
        pp_total += pp
        sys.stderr.write(f"  upserted batch {i // batch_size + 1}: products={p} prices={pp} (cum {p_total}/{len(rows)})\n")

    sys.stderr.write(f"done: products={p_total} prices={pp_total}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
