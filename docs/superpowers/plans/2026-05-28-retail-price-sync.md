# Retail Price Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest product prices from 7 Israeli supermarket chains into Supabase DB, refreshed twice daily via GitHub Actions.

**Architecture:** Python worker in a separate public repo fetches XML files (HTTPS for Shufersal/Mega, FTP via ftplib for 5 chains) and POSTs batched rows to a Supabase Edge Function. The Edge Function calls a Postgres RPC that stages, merges, and captures deltas atomically. GitHub Actions matrix with `fail-fast: false` and `max-parallel: 2`.

**Tech Stack:** TypeScript/Deno (Edge Function), Python 3.12 + ftplib + requests (worker), GitHub Actions, Supabase PostgreSQL, Zod

---

## File Map

### App repo (`c:\Users\avita\Claude_Projects\ShoppingList`)
| File | Action |
|------|--------|
| `supabase/migrations/0016_retail_price_sync.sql` | Create |
| `supabase/migrations/0017_ingest_batch_rpc.sql` | Create |
| `supabase/functions/refresh-products/deno.json` | Create |
| `supabase/functions/refresh-products/index.ts` | Create |

### Worker repo (`shopping-price-ingestor`, new public repo)
| File | Action |
|------|--------|
| `.github/workflows/ingest-prices.yml` | Create |
| `ingestion/__init__.py` | Create |
| `ingestion/chains.py` | Create |
| `ingestion/fetcher.py` | Create |
| `ingestion/parser.py` | Create |
| `ingestion/uploader.py` | Create |
| `ingestion/run.py` | Create |
| `tests/__init__.py` | Create |
| `tests/test_parser.py` | Create |
| `tests/test_uploader.py` | Create |
| `requirements.txt` | Create |
| `requirements-lock.txt` | Create |

---

## Phase A — Supabase (app repo)

---

### Task 1: Migration 0016 — New Tables

**Files:**
- Create: `supabase/migrations/0016_retail_price_sync.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0016_retail_price_sync.sql

-- Extend refresh_log with per-chain fields
ALTER TABLE shopping.refresh_log ADD COLUMN IF NOT EXISTS chain_code     text;
ALTER TABLE shopping.refresh_log ADD COLUMN IF NOT EXISTS rows_upserted  integer;
ALTER TABLE shopping.refresh_log ADD COLUMN IF NOT EXISTS rows_changed   integer;
ALTER TABLE shopping.refresh_log ADD COLUMN IF NOT EXISTS status         text;

-- Dedup: skip already-processed files
CREATE TABLE IF NOT EXISTS shopping.ingested_files (
  chain_code   text        NOT NULL,
  file_name    text        NOT NULL,
  sha256       text        NOT NULL,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_code, file_name)
);

-- Staging: UNLOGGED = fast bulk write, no WAL overhead
-- PK on (chain_code, barcode) prevents cross-chain race conditions
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

-- Price change history (append-only, 90-day TTL via pg_cron)
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

-- Multi-chain query index
CREATE INDEX IF NOT EXISTS product_prices_chain_barcode
  ON shopping.product_prices (chain_code, barcode);

-- Disable realtime WAL fan-out on high-write tables
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS shopping.product_prices;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS shopping.product_price_changes;

-- Seed 6 new chains
INSERT INTO shopping.chains (chain_code, display_name) VALUES
  ('mega',       'מגה'),
  ('rami_levy',  'רמי לוי'),
  ('victory',    'ויקטורי'),
  ('osher_ad',   'אושר עד'),
  ('hazi_hinam', 'חצי חינם'),
  ('yohananof',  'יוחננוף')
ON CONFLICT (chain_code) DO NOTHING;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```

Verify:
```bash
npx supabase db execute --command "SELECT table_name FROM information_schema.tables WHERE table_schema='shopping' ORDER BY table_name"
```
Expected: `ingested_files`, `product_price_changes`, `staging_prices` appear in output.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0016_retail_price_sync.sql
git commit -m "feat(db): migration 0016 — retail price sync tables, indexes, chain seeds"
```

---

### Task 2: Migration 0017 — ingest_batch RPC

**Files:**
- Create: `supabase/migrations/0017_ingest_batch_rpc.sql`

- [ ] **Step 1: Write the RPC**

```sql
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

  -- Write heartbeat
  INSERT INTO shopping.refresh_log (chain_code, status, rows_upserted, rows_changed)
  VALUES (p_chain_code, 'success', v_upserted, v_changed);

  RETURN jsonb_build_object('status', 'ok', 'upserted', v_upserted, 'changed', v_changed);
END;
$$;

GRANT EXECUTE ON FUNCTION shopping.ingest_batch TO service_role;
```

- [ ] **Step 2: Apply and smoke-test**

```bash
npx supabase db push
```

```bash
npx supabase db execute --command "
SELECT shopping.ingest_batch(
  'shufersal', 'test.xml', 'sha256abc',
  '[{\"barcode\":\"7290000000001\",\"item_name\":\"חלב\",\"price\":6.90,\"updated_at\":\"2026-05-28T05:00:00Z\"}]'::jsonb,
  true
);"
```
Expected: `{"status": "ok", "upserted": 1, "changed": 0}`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0017_ingest_batch_rpc.sql
git commit -m "feat(db): migration 0017 — shopping.ingest_batch RPC for staged price ingestion"
```

---

### Task 3: Edge Function

**Files:**
- Create: `supabase/functions/refresh-products/deno.json`
- Create: `supabase/functions/refresh-products/index.ts`

- [ ] **Step 1: Create deno.json**

```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2.39.0",
    "zod": "https://esm.sh/zod@3.22.4"
  }
}
```

- [ ] **Step 2: Write index.ts**

```typescript
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ALL_CHAINS = ["shufersal","mega","rami_levy","victory","osher_ad","hazi_hinam","yohananof"];
const STALE_MS   = 14 * 60 * 60 * 1000; // 14h — aligned with twice-daily cron

const RowSchema = z.object({
  barcode:    z.string().min(1),
  item_name:  z.string().min(1),
  price:      z.number().positive(),
  updated_at: z.string(),
});
const IngestSchema = z.object({
  chain_code: z.string().min(1),
  file_name:  z.string().min(1),
  sha256:     z.string().min(1),
  is_final:   z.boolean(),
  rows:       z.array(RowSchema).min(1).max(5000),
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  const key = Deno.env.get("INGEST_KEY");
  if (req.headers.get("Authorization") !== `Bearer ${key}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const path = new URL(req.url).pathname.split("/").pop();

  if (req.method === "POST" && path === "ingest") {
    let body: unknown;
    try { body = await req.json(); }
    catch { return json({ error: "Invalid JSON" }, 400); }

    const parsed = IngestSchema.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

    const { chain_code, file_name, sha256, is_final, rows } = parsed.data;
    const { data, error } = await supabase.rpc("ingest_batch", {
      p_chain_code: chain_code,
      p_file_name:  file_name,
      p_sha256:     sha256,
      p_rows:       rows,
      p_is_final:   is_final,
    });
    if (error) { console.error(error); return json({ error: error.message }, 500); }
    return json(data);
  }

  if (req.method === "GET" && path === "health") {
    const { data, error } = await supabase
      .from("refresh_log")
      .select("chain_code, created_at")
      .order("created_at", { ascending: false });

    if (error) return json({ error: error.message }, 500);

    const now = Date.now();
    const latest = new Map<string, number>();
    for (const row of data ?? []) {
      if (!latest.has(row.chain_code))
        latest.set(row.chain_code, new Date(row.created_at).getTime());
    }

    const stale = ALL_CHAINS.filter(c => {
      const t = latest.get(c);
      return !t || (now - t) > STALE_MS;
    });
    const ok = ALL_CHAINS.filter(c => !stale.includes(c));

    return json({ stale_chains: stale, ok_chains: ok, checked_at: new Date().toISOString() },
                stale.length > 0 ? 503 : 200);
  }

  return json({ error: "Not found" }, 404);
});
```

- [ ] **Step 3: Test locally**

Add to `.env.local`:
```
INGEST_KEY=test-key-local
```

```bash
npx supabase functions serve refresh-products --env-file .env.local
```

In another terminal:
```bash
curl -s -H "Authorization: Bearer test-key-local" \
  http://localhost:54321/functions/v1/refresh-products/health | jq .
```
Expected: JSON with all 7 chains in `stale_chains`.

- [ ] **Step 4: Deploy**

```bash
npx supabase functions deploy refresh-products
npx supabase secrets set INGEST_KEY=$(openssl rand -hex 32)
```

Save the generated key — you'll need it for GitHub Secrets.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/refresh-products/
git commit -m "feat(edge): refresh-products — POST /ingest + GET /health"
```

---

## Phase B — Worker repo

---

### Task 4: Repo Setup + chains.py

- [ ] **Step 1: Create repo**

```bash
# Outside the ShoppingList repo
mkdir shopping-price-ingestor && cd shopping-price-ingestor
git init
mkdir -p ingestion tests .github/workflows
touch ingestion/__init__.py tests/__init__.py
```

- [ ] **Step 2: Verify GS1 IDs**

In Claude Code (in the ShoppingList project), run the `list_chains` MCP tool from `mcp__supermarket-prices`. Note the `id` field for each of the 7 chains. Update the `gs1_id` values in Step 3 below if they differ.

- [ ] **Step 3: Write ingestion/chains.py**

```python
from dataclasses import dataclass
from typing import Literal

@dataclass(frozen=True)
class ChainConfig:
    chain_code:   str
    display_name: str
    access_type:  Literal["https_shufersal", "https_publishprice", "ftp"]
    gs1_id:       str
    endpoint:     str

# GS1 IDs — verify with list_chains MCP tool before first run
CHAINS: dict[str, ChainConfig] = {
    "shufersal": ChainConfig(
        chain_code="shufersal",
        display_name="שופרסל",
        access_type="https_shufersal",
        gs1_id="7290027600007",
        endpoint="https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=5",
    ),
    "mega": ChainConfig(
        chain_code="mega",
        display_name="מגה",
        access_type="https_publishprice",
        gs1_id="7290055700007",
        endpoint="https://prices.carrefour.co.il/",
    ),
    "rami_levy": ChainConfig(
        chain_code="rami_levy",
        display_name="רמי לוי",
        access_type="ftp",
        gs1_id="7290058140886",
        endpoint="url.retail.publishedprices.co.il",
    ),
    "victory": ChainConfig(
        chain_code="victory",
        display_name="ויקטורי",
        access_type="ftp",
        gs1_id="7290696200003",
        endpoint="url.retail.publishedprices.co.il",
    ),
    "osher_ad": ChainConfig(
        chain_code="osher_ad",
        display_name="אושר עד",
        access_type="ftp",
        gs1_id="7290103152017",
        endpoint="url.retail.publishedprices.co.il",
    ),
    "hazi_hinam": ChainConfig(
        chain_code="hazi_hinam",
        display_name="חצי חינם",
        access_type="ftp",
        gs1_id="7290055221722",
        endpoint="url.retail.publishedprices.co.il",
    ),
    "yohananof": ChainConfig(
        chain_code="yohananof",
        display_name="יוחננוף",
        access_type="ftp",
        gs1_id="7290803800003",
        endpoint="url.retail.publishedprices.co.il",
    ),
}
```

- [ ] **Step 4: Create requirements.txt**

```
requests==2.31.0
```

```bash
pip install -r requirements.txt
pip freeze > requirements-lock.txt
```

- [ ] **Step 5: Commit**

```bash
git add ingestion/ tests/ requirements.txt requirements-lock.txt
git commit -m "feat(worker): repo setup, chain config, dependencies"
```

---

### Task 5: fetcher.py

**Files:**
- Create: `ingestion/fetcher.py`

- [ ] **Step 1: Write ingestion/fetcher.py**

```python
import ftplib
import hashlib
import io
import json
import re
from typing import NamedTuple

import requests

from ingestion.chains import ChainConfig

UA = "ShoppingListApp/1.0 (avitantal@gmail.com)"
HEADERS = {"User-Agent": UA}
TIMEOUT = 60
FTP_HOST = "url.retail.publishedprices.co.il"


class FileEntry(NamedTuple):
    file_name: str
    url: str  # empty for FTP files


def list_files(chain: ChainConfig) -> list[FileEntry]:
    """Return PriceFull gz files for a chain, newest first."""
    if chain.access_type == "https_shufersal":
        return _list_shufersal(chain.endpoint)
    if chain.access_type == "https_publishprice":
        return _list_publishprice(chain.endpoint)
    if chain.access_type == "ftp":
        return _list_ftp(chain.gs1_id)
    raise ValueError(f"Unknown access_type: {chain.access_type}")


def download_file(chain: ChainConfig, entry: FileEntry) -> bytes:
    """Return raw gz bytes."""
    if chain.access_type == "ftp":
        return _download_ftp(chain.gs1_id, entry.file_name)
    resp = requests.get(entry.url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.content


def file_sha256(file_name: str) -> str:
    return hashlib.sha256(file_name.encode()).hexdigest()


def _list_shufersal(endpoint: str) -> list[FileEntry]:
    resp = requests.get(endpoint, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    pattern = r'/FileObject/UpdateFile\?fileName=(PriceFull[^\'"&]+\.gz)'
    found = re.findall(pattern, resp.text)
    base = "https://prices.shufersal.co.il/FileObject/UpdateFile?fileName="
    entries = [FileEntry(f, base + f) for f in found]
    return sorted(entries, key=lambda e: e.file_name, reverse=True)


def _list_publishprice(endpoint: str) -> list[FileEntry]:
    resp = requests.get(endpoint, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    match = re.search(r'const files\s*=\s*(\[.*?\]);', resp.text, re.DOTALL)
    if not match:
        return []
    raw = match.group(1).replace("'", '"')
    items = json.loads(raw)
    entries = [
        FileEntry(item["name"], item["url"])
        for item in items
        if item.get("name", "").startswith("PriceFull")
    ]
    return sorted(entries, key=lambda e: e.file_name, reverse=True)


def _list_ftp(gs1_id: str) -> list[FileEntry]:
    try:
        with ftplib.FTP(FTP_HOST, timeout=30) as ftp:
            ftp.login()
            ftp.cwd(gs1_id)
            files = ftp.nlst()
    except ftplib.all_errors:
        return []
    pricefull = [f for f in files if f.startswith("PriceFull") and f.endswith(".gz")]
    return [FileEntry(f, "") for f in sorted(pricefull, reverse=True)]


def _download_ftp(gs1_id: str, file_name: str) -> bytes:
    buf = io.BytesIO()
    with ftplib.FTP(FTP_HOST, timeout=60) as ftp:
        ftp.login()
        ftp.cwd(gs1_id)
        ftp.retrbinary(f"RETR {file_name}", buf.write)
    return buf.getvalue()
```

- [ ] **Step 2: Commit**

```bash
git add ingestion/fetcher.py
git commit -m "feat(worker): fetcher — HTTPS (Shufersal, Mega) + FTP download"
```

---

### Task 6: parser.py (TDD)

**Files:**
- Create: `tests/test_parser.py`
- Create: `ingestion/parser.py`

- [ ] **Step 1: Write tests/test_parser.py**

```python
import gzip
import pytest
from ingestion.parser import parse_price_xml

_XML = b"""<?xml version="1.0" encoding="utf-8"?>
<root>
  <Items>
    <Item>
      <ItemCode>7290000000001</ItemCode>
      <ItemName>חלב תנובה 3%</ItemName>
      <ItemPrice>6.90</ItemPrice>
      <PriceUpdateDate>2026-05-28 00:00</PriceUpdateDate>
    </Item>
    <Item>
      <ItemCode>7290000000002</ItemCode>
      <ItemName></ItemName>
      <ItemPrice>5.00</ItemPrice>
      <PriceUpdateDate>2026-05-28 00:00</PriceUpdateDate>
    </Item>
    <Item>
      <ItemCode>7290000000003</ItemCode>
      <ItemName>מוצר</ItemName>
      <ItemPrice>0</ItemPrice>
      <PriceUpdateDate>2026-05-28 00:00</PriceUpdateDate>
    </Item>
    <Item>
      <ItemCode>7290000000004</ItemCode>
      <ItemName>פריט תקין</ItemName>
      <ItemPrice>12.50</ItemPrice>
      <PriceUpdateDate>2026-05-28 00:00</PriceUpdateDate>
    </Item>
  </Items>
</root>"""

_GZ = gzip.compress(_XML)


def test_filters_empty_name_and_zero_price():
    rows = parse_price_xml(_GZ)
    assert len(rows) == 2  # items 2 (empty name) and 3 (price=0) filtered out


def test_correct_field_values():
    rows = parse_price_xml(_GZ)
    first = next(r for r in rows if r["barcode"] == "7290000000001")
    assert first["item_name"] == "חלב תנובה 3%"
    assert first["price"] == pytest.approx(6.90)
    assert "updated_at" in first


def test_empty_items_returns_empty_list():
    xml = gzip.compress(b"""<?xml version="1.0"?><root><Items></Items></root>""")
    assert parse_price_xml(xml) == []
```

- [ ] **Step 2: Run to verify failure**

```bash
python -m pytest tests/test_parser.py -v
```
Expected: `ImportError` — `ingestion.parser` doesn't exist yet

- [ ] **Step 3: Write ingestion/parser.py**

```python
import gzip
import io
import xml.etree.ElementTree as ET
from datetime import datetime, timezone


def parse_price_xml(gz_data: bytes) -> list[dict]:
    """Parse a PriceFull gz XML → normalized price rows.

    Streaming iterparse handles 100MB+ files without OOM.
    Rejects rows where barcode is empty, item_name is empty, or price <= 0.
    """
    raw = gzip.decompress(gz_data)
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = []

    for _, elem in ET.iterparse(io.BytesIO(raw), events=("end",)):
        if elem.tag != "Item":
            continue

        barcode   = (elem.findtext("ItemCode")       or "").strip()
        item_name = (elem.findtext("ItemName")        or "").strip()
        price_str = (elem.findtext("ItemPrice")       or "0").strip()
        updated   = (elem.findtext("PriceUpdateDate") or "").strip()
        elem.clear()

        if not barcode or not item_name:
            continue
        try:
            price = float(price_str)
        except ValueError:
            continue
        if price <= 0:
            continue

        rows.append({
            "barcode":    barcode,
            "item_name":  item_name,
            "price":      round(price, 2),
            "updated_at": updated or now_iso,
        })

    return rows
```

- [ ] **Step 4: Run to verify passing**

```bash
python -m pytest tests/test_parser.py -v
```
Expected: 3 tests PASSED

- [ ] **Step 5: Commit**

```bash
git add ingestion/parser.py tests/test_parser.py
git commit -m "feat(worker): streaming XML parser with tests"
```

---

### Task 7: uploader.py (TDD)

**Files:**
- Create: `tests/test_uploader.py`
- Create: `ingestion/uploader.py`

- [ ] **Step 1: Write tests/test_uploader.py**

```python
from unittest.mock import MagicMock, patch

from ingestion.uploader import upload_batches

_ROWS = [
    {"barcode": f"729000000{i:04d}", "item_name": f"פריט {i}", "price": 5.0 + i,
     "updated_at": "2026-05-28T05:00:00Z"}
    for i in range(12)
]


def _mock_post(status=200, body=None):
    def fake(url, json, headers, timeout):
        resp = MagicMock()
        resp.status_code = status
        resp.json.return_value = body or {"status": "staged"}
        resp.raise_for_status = lambda: None
        return resp
    return fake


def test_splits_into_correct_number_of_batches():
    calls = []

    def capture(url, json, headers, timeout):
        calls.append(json)
        return _mock_post()(url, json, headers, timeout)

    with patch("ingestion.uploader.requests.post", side_effect=capture):
        upload_batches(_ROWS, "shufersal", "f.xml", "sha", "http://x/ingest", "k", batch_size=5)

    assert len(calls) == 3  # ceil(12/5)


def test_only_last_batch_is_final():
    calls = []

    def capture(url, json, headers, timeout):
        calls.append(json)
        return _mock_post()(url, json, headers, timeout)

    with patch("ingestion.uploader.requests.post", side_effect=capture):
        upload_batches(_ROWS, "shufersal", "f.xml", "sha", "http://x/ingest", "k", batch_size=5)

    assert calls[0]["is_final"] is False
    assert calls[1]["is_final"] is False
    assert calls[2]["is_final"] is True


def test_returns_final_batch_response():
    final_resp = {"status": "ok", "upserted": 12, "changed": 3}

    responses = [
        _mock_post(body={"status": "staged"})("", {}, {}, 0),
        _mock_post(body={"status": "staged"})("", {}, {}, 0),
        _mock_post(body=final_resp)("", {}, {}, 0),
    ]
    it = iter(responses)

    with patch("ingestion.uploader.requests.post", side_effect=lambda *a, **k: next(it)):
        result = upload_batches(_ROWS, "shufersal", "f.xml", "sha", "http://x/ingest", "k", batch_size=5)

    assert result == final_resp
```

- [ ] **Step 2: Run to verify failure**

```bash
python -m pytest tests/test_uploader.py -v
```
Expected: `ImportError`

- [ ] **Step 3: Write ingestion/uploader.py**

```python
import requests

BATCH_SIZE = 5_000


def upload_batches(
    rows: list[dict],
    chain_code: str,
    file_name: str,
    sha256: str,
    edge_url: str,
    ingest_key: str,
    batch_size: int = BATCH_SIZE,
) -> dict:
    """POST rows in batches to Edge Function /ingest. Returns final batch response."""
    headers = {"Authorization": f"Bearer {ingest_key}", "Content-Type": "application/json"}
    batches = [rows[i:i + batch_size] for i in range(0, len(rows), batch_size)]
    result: dict = {}

    for idx, batch in enumerate(batches):
        payload = {
            "chain_code": chain_code,
            "file_name":  file_name,
            "sha256":     sha256,
            "is_final":   idx == len(batches) - 1,
            "rows":       batch,
        }
        resp = requests.post(edge_url, json=payload, headers=headers, timeout=120)
        resp.raise_for_status()
        result = resp.json()

    return result
```

- [ ] **Step 4: Run all tests**

```bash
python -m pytest tests/ -v
```
Expected: 6 tests PASSED

- [ ] **Step 5: Commit**

```bash
git add ingestion/uploader.py tests/test_uploader.py
git commit -m "feat(worker): batch uploader with tests"
```

---

### Task 8: run.py + GitHub Actions

**Files:**
- Create: `ingestion/run.py`
- Create: `.github/workflows/ingest-prices.yml`

- [ ] **Step 1: Write ingestion/run.py**

```python
import argparse
import os
import sys

from ingestion.chains import CHAINS
from ingestion.fetcher import download_file, file_sha256, list_files
from ingestion.parser import parse_price_xml
from ingestion.uploader import upload_batches


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chain", required=True, choices=list(CHAINS.keys()))
    chain = CHAINS[parser.parse_args().chain]

    edge_url = os.environ["SUPABASE_URL"].rstrip("/") + "/functions/v1/refresh-products/ingest"
    ingest_key = os.environ["INGEST_KEY"]

    print(f"[{chain.chain_code}] Listing files...")
    files = list_files(chain)
    if not files:
        print(f"[{chain.chain_code}] No PriceFull files found — skipping")
        return

    entry = files[0]
    sha = file_sha256(entry.file_name)
    print(f"[{chain.chain_code}] Latest: {entry.file_name}")

    print(f"[{chain.chain_code}] Downloading...")
    gz_data = download_file(chain, entry)

    print(f"[{chain.chain_code}] Parsing ({len(gz_data)/1024/1024:.1f} MB)...")
    rows = parse_price_xml(gz_data)
    if not rows:
        print(f"[{chain.chain_code}] No valid rows — skipping")
        return

    print(f"[{chain.chain_code}] Uploading {len(rows):,} rows...")
    result = upload_batches(
        rows=rows, chain_code=chain.chain_code, file_name=entry.file_name,
        sha256=sha, edge_url=edge_url, ingest_key=ingest_key,
    )

    status = result.get("status")
    if status == "already_ingested":
        print(f"[{chain.chain_code}] Already ingested — skipping")
    elif status == "ok":
        print(f"[{chain.chain_code}] Done: {result.get('upserted'):,} upserted, {result.get('changed'):,} changed")
    else:
        print(f"[{chain.chain_code}] Unexpected: {result}")
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write .github/workflows/ingest-prices.yml**

```yaml
name: Ingest Prices

on:
  schedule:
    - cron: '0 5,16 * * *'   # 05:00 + 16:00 UTC — PriceFull updates once/twice daily
  workflow_dispatch:           # manual trigger for debugging

jobs:
  ingest:
    name: Ingest ${{ matrix.chain }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        chain: [shufersal, mega, rami_levy, victory, osher_ad, hazi_hinam, yohananof]
      fail-fast: false
      max-parallel: 2          # FTP chains share one server — avoid IP block
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Install dependencies
        run: pip install -r requirements-lock.txt

      - name: Ingest ${{ matrix.chain }}
        run: python -m ingestion.run --chain ${{ matrix.chain }}
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          INGEST_KEY:   ${{ secrets.INGEST_KEY }}
```

- [ ] **Step 3: Commit and push**

```bash
git add ingestion/run.py .github/workflows/ingest-prices.yml
git commit -m "feat(worker): run.py entry point + GitHub Actions matrix workflow"
git push -u origin main
```

---

### Task 9: End-to-End Test + Monitoring

- [ ] **Step 1: Add GitHub Secrets**

In `shopping-price-ingestor` → Settings → Secrets → Actions:
- `SUPABASE_URL` = your Supabase project URL (`https://<ref>.supabase.co`)
- `INGEST_KEY` = the value you set with `supabase secrets set INGEST_KEY=...`

- [ ] **Step 2: Test run — Shufersal only**

In GitHub UI: Actions → Ingest Prices → Run workflow.

Expected logs:
```
[shufersal] Listing files...
[shufersal] Latest: PriceFull7290027600007-001-YYYYMMDD0000.xml.gz
[shufersal] Downloading...
[shufersal] Parsing (X.X MB)...
[shufersal] Uploading N,NNN rows...
[shufersal] Done: N,NNN upserted, 0 changed
```

- [ ] **Step 3: Verify rows in Supabase**

In the ShoppingList app repo:
```bash
npx supabase db execute --command "SELECT COUNT(*) FROM shopping.product_prices WHERE chain_code='shufersal'"
```
Expected: count > 10,000

- [ ] **Step 4: Verify heartbeat**

```bash
npx supabase db execute --command "SELECT chain_code, status, rows_upserted, created_at FROM shopping.refresh_log ORDER BY created_at DESC LIMIT 3"
```
Expected: row with `chain_code='shufersal'`, `status='success'`

- [ ] **Step 5: Verify /health endpoint**

```bash
curl -s -H "Authorization: Bearer $INGEST_KEY" \
  "https://<project-ref>.supabase.co/functions/v1/refresh-products/health" | jq .
```
Expected: `shufersal` in `ok_chains`

- [ ] **Step 6: Enable all 7 chains**

Trigger workflow_dispatch without modification. All 7 matrix jobs run. Accept that some FTP chains may fail on the first attempt — `fail-fast: false` ensures the others continue.

- [ ] **Step 7: Set up UptimeRobot**

1. [uptimerobot.com](https://uptimerobot.com) → Add Monitor → HTTP(s) Keyword
2. URL: `https://<ref>.supabase.co/functions/v1/refresh-products/health`
3. Keyword to exist: `"ok_chains"` (always present — confirms function is up)
4. Alert contact header: `Authorization: Bearer <INGEST_KEY>`
5. Interval: 30 minutes
6. Email alert on: keyword missing OR HTTP error

- [ ] **Step 8: Enable pg_cron**

In Supabase dashboard: Database → Extensions → enable `pg_cron`.

```bash
npx supabase db execute --command "
SELECT cron.schedule(
  'prune-price-changes',
  '0 3 * * *',
  \$\$DELETE FROM shopping.product_price_changes WHERE changed_at < now() - interval ''90 days''\$\$
);"
```

- [ ] **Step 9: Bump version in app repo**

```bash
cd c:\Users\avita\Claude_Projects\ShoppingList
npm version minor
```
Update version label in UI (per project convention — top-of-page indicator).

```bash
git add package.json src/
git commit -m "feat: retail price sync pipeline — 7 chains live"
```
