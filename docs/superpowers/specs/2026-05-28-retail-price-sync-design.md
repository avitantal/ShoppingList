# Retail Price Sync — Design Spec
**Date:** 2026-05-28  
**Status:** Approved for implementation  
**Scope:** Phase 1 — 7 chains, chain-level prices, GitHub Actions ingestion pipeline

---

## Overview

Pull live product prices from 7 major Israeli supermarket chains into the app's Supabase DB, refreshed every 30 minutes. Leverages the חוק המזון (Food Transparency Law) XML feeds that all chains are legally required to publish.

**Non-goal:** Store-level pricing, promotions sync, full SKU coverage — these are Phase 2+.

---

## Chains in Scope

| Chain | `chain_code` | Access | Feed URL |
|-------|-------------|--------|----------|
| שופרסל | `shufersal` | HTTPS direct | `prices.shufersal.co.il` |
| מגה/קרפור | `mega` | HTTPS (publishprice) | `prices.carrefour.co.il` |
| רמי לוי | `rami_levy` | FTP | `url.retail.publishedprices.co.il` |
| ויקטורי | `victory` | FTP | same |
| אושר עד | `osher_ad` | FTP | same |
| חצי חינם | `hazi_hinam` | FTP | same |
| יוחננוף | `yohananof` | FTP | same |

---

## Architecture

```
GitHub Actions (repo: shopping-price-ingestor, public)
  cron: 0 5,16 * * *  (05:00 + 16:00 — PriceFull מתעדכן פעם/פעמיים ביום)
  matrix: 7 chains, fail-fast: false
  per chain:
    1. fetch file list from chain feed
    2. compute SHA256 of file name
    3. skip if SHA exists in shopping.ingested_files
    4. download + decompress XML
    5. parse → normalized rows (reject: empty name, price ≤ 0)
    6. POST batches of 5,000 rows → Edge Function /ingest
    7. write heartbeat to refresh_log

Supabase Edge Function: refresh-products (existing, now implemented)
  POST /ingest
    → INSERT batch → staging_prices
    → MERGE staging → product_prices (upsert, only on price change)
    → INSERT → product_price_changes (delta only)
    → INSERT → ingested_files (dedup record)
    → UPDATE refresh_log heartbeat
    → TRUNCATE staging_prices

  GET /health
    → return chains with last successful run > 2h ago

UptimeRobot → GET /health every 30 min → email alert on stale chains
```

---

## Database Schema

### New tables (migration 0016)

```sql
-- Dedup: never process the same file twice
CREATE TABLE shopping.ingested_files (
  chain_code   text        NOT NULL,
  file_name    text        NOT NULL,
  sha256       text        NOT NULL,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_code, file_name)
);

-- Temp staging, UNLOGGED for speed (no WAL, no backup needed)
-- PK on (chain_code, barcode) prevents cross-chain race conditions when matrix runs in parallel
CREATE UNLOGGED TABLE shopping.staging_prices (
  barcode      text           NOT NULL,
  chain_code   text           NOT NULL,
  item_name    text           NOT NULL,
  price        numeric(10,2)  NOT NULL,
  updated_at   timestamptz    NOT NULL,
  PRIMARY KEY (chain_code, barcode)
);
CREATE INDEX ON shopping.staging_prices (barcode, chain_code); -- for JOIN in delta detection

-- Append-only price change history (90-day TTL via pg_cron)
CREATE TABLE shopping.product_price_changes (
  id           bigserial      PRIMARY KEY,
  barcode      text           NOT NULL,
  chain_code   text           NOT NULL,
  old_price    numeric(10,2),
  new_price    numeric(10,2)  NOT NULL,
  changed_at   timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX ON shopping.product_price_changes (barcode, chain_code, changed_at DESC);

-- pg_cron cleanup (add after enabling extension in Supabase dashboard)
SELECT cron.schedule(
  'prune-price-changes',
  '0 3 * * *',
  $$DELETE FROM shopping.product_price_changes WHERE changed_at < now() - interval '90 days'$$
);
```

### Updated tables

```sql
-- Extend refresh_log with chain_code (if not already present)
ALTER TABLE shopping.refresh_log ADD COLUMN IF NOT EXISTS chain_code text;

-- Seed 5 new chains into shopping.chains
INSERT INTO shopping.chains (chain_code, display_name, access_type) VALUES
  ('rami_levy',  'רמי לוי',    'ftp'),
  ('victory',    'ויקטורי',    'ftp'),
  ('osher_ad',   'אושר עד',    'ftp'),
  ('hazi_hinam', 'חצי חינם',   'ftp'),
  ('yohananof',  'יוחננוף',    'ftp'),
  ('mega',       'מגה',        'https')
ON CONFLICT (chain_code) DO NOTHING;
```

### Indexes

```sql
-- product_prices (existing table, new index for multi-chain queries)
CREATE INDEX IF NOT EXISTS product_prices_chain_barcode
  ON shopping.product_prices (chain_code, barcode);

-- Disable realtime replication on high-write tables
ALTER PUBLICATION supabase_realtime DROP TABLE shopping.product_prices;
ALTER PUBLICATION supabase_realtime DROP TABLE shopping.product_price_changes;
```

---

## GitHub Actions Worker

**Repo:** `shopping-price-ingestor` (public, separate from app repo)

### File structure

```
shopping-price-ingestor/
├── .github/workflows/ingest-prices.yml
├── ingestion/
│   ├── run.py          — entry point per chain
│   ├── chains.py       — chain config (endpoint, access_type, chain_id)
│   ├── fetcher.py      — download XML (HTTPS or FTP via OpenIsraeliSupermarkets)
│   ├── parser.py       — XML → normalized rows
│   └── uploader.py     — POST batched JSON → Edge Function
├── vendor/
│   └── openisraelisupermarkets/  — vendored at pinned commit (not pip-installed from main)
├── requirements.txt
└── requirements-lock.txt
```

### Workflow

```yaml
# .github/workflows/ingest-prices.yml
on:
  schedule:
    - cron: '0 5,16 * * *'   # 05:00 + 16:00 UTC — PriceFull updates once/twice daily
  workflow_dispatch:           # manual trigger for debugging
jobs:
  ingest:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        chain: [shufersal, mega, rami_levy, victory, osher_ad, hazi_hinam, yohananof]
      fail-fast: false
      max-parallel: 2   # shufersal+mega = HTTPS; FTP chains share one server — avoid IP block
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements-lock.txt
      - run: python ingestion/run.py --chain ${{ matrix.chain }}
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          INGEST_KEY:   ${{ secrets.INGEST_KEY }}
```

### run.py logic (per chain)

```
1. load chain config from chains.py
2. fetch file list from chain endpoint
3. for each file (newest first, limit 1 PriceFull per run):
   a. skip if (chain_code, file_name) exists in ingested_files (via /ingest dry-check)
   b. download + decompress gz
   c. parse XML → list of { barcode, item_name, price, updated_at }
   d. filter: reject rows where item_name is empty or price ≤ 0
   e. split into batches of 5,000
   f. POST each batch to Edge Function /ingest
      - intermediate batches: { ..., is_final: false }
      - last batch: { ..., is_final: true }  → triggers heartbeat write
4. log result from final response (rows upserted, rows changed, errors)
```

**Note:** Only Edge Function writes to `refresh_log`. Worker has no direct DB access.

**User-Agent:** `ShoppingListApp/1.0 (avitantal@gmail.com)`

### GitHub Secrets required

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | Project URL |
| `INGEST_KEY` | Scoped DB role key (not service_role) |

---

## Edge Function

**File:** `supabase/functions/refresh-products/index.ts` (implement existing scaffold)

### POST /ingest

**Request body:**
```json
{
  "chain_code": "rami_levy",
  "file_name": "PriceFull7290058140886-001-202405280000.xml.gz",
  "sha256": "abc123...",
  "is_final": false,
  "rows": [
    { "barcode": "7290000000001", "item_name": "חלב תנובה 3%", "price": 6.90, "updated_at": "2026-05-28T00:00:00Z" }
  ]
}
```

**Auth:** `Authorization: Bearer <INGEST_KEY>` — validated against env var.

**Steps:**
1. Validate auth header
2. Check `ingested_files` — if `(chain_code, file_name)` exists → return `200 { status: "already_ingested" }`
3. `INSERT` rows → `staging_prices`
4. `MERGE` staging → `product_prices`:
   ```sql
   INSERT INTO shopping.product_prices (barcode, chain_code, price, updated_at)
   SELECT barcode, chain_code, price, updated_at FROM shopping.staging_prices
   ON CONFLICT (barcode, chain_code)
   DO UPDATE SET price = EXCLUDED.price, updated_at = EXCLUDED.updated_at
   WHERE product_prices.price IS DISTINCT FROM EXCLUDED.price
   ```
5. `INSERT` into `product_price_changes` — rows where price changed (join staging vs current)
6. `INSERT` into `ingested_files`
7. If `is_final: true`: `UPDATE refresh_log` heartbeat (chain_code, rows_upserted, rows_changed, status='success')
8. `DELETE FROM shopping.staging_prices WHERE chain_code = $chain_code` — targeted, not global TRUNCATE
9. Return `{ upserted: N, changed: M, skipped: K }`

### GET /health

```json
{
  "stale_chains": ["rami_levy", "osher_ad"],
  "ok_chains": ["shufersal", "mega", "victory", "hazi_hinam", "yohananof"],
  "checked_at": "2026-05-28T10:30:00Z"
}
```

Returns stale = last successful run > 14 hours ago (aligned with twice-daily cron). UptimeRobot pings every 30 min; alerts on non-empty `stale_chains`.

---

## Security

| Concern | Mitigation |
|---------|-----------|
| Leaked `INGEST_KEY` | Scoped role: only INSERT/UPDATE on ingestion tables. No reads of user data. |
| SSRF in Edge Function | Edge Function does not fetch external URLs — only receives POST from worker. |
| Malformed XML | Parser rejects rows with empty name or price ≤ 0; Edge Function validates batch schema with Zod. |
| Chain blocking worker | User-Agent identifies app; `fail-fast: false` so one blocked chain doesn't stop others. |

---

## DB Role Setup

```sql
CREATE ROLE ingest_role;
GRANT INSERT, UPDATE ON shopping.staging_prices TO ingest_role;
GRANT INSERT, UPDATE ON shopping.product_prices TO ingest_role;
GRANT INSERT ON shopping.product_price_changes TO ingest_role;
GRANT INSERT ON shopping.ingested_files TO ingest_role;
GRANT INSERT, UPDATE ON shopping.refresh_log TO ingest_role;
GRANT SELECT ON shopping.ingested_files TO ingest_role;  -- for dedup check
```

---

## Monitoring

- **UptimeRobot** (free): ping `GET /health` every 30 min → email alert if `stale_chains` non-empty (threshold: >14h)
- **refresh_log**: each run writes chain_code, started_at, finished_at, status, rows_upserted, error
- **workflow_dispatch**: manual re-run from GitHub Actions UI for any chain

---

## Rollout Plan

1. **Migration 0016** — new tables + chain seeds + indexes
2. **DB role** — create `ingest_role`, generate scoped key
3. **Edge Function** — implement `index.ts` in existing scaffold
4. **Worker repo** — create `shopping-price-ingestor`, vendor OpenIsraeliSupermarkets
5. **GitHub Secrets** — add SUPABASE_URL + INGEST_KEY
6. **Test run** — `workflow_dispatch` on Shufersal only, verify rows land in product_prices
7. **Enable cron** — turn on `*/30` schedule for all 7 chains
8. **UptimeRobot** — wire `/health` endpoint

---

## Out of Scope (Phase 2+)

- Store-level prices
- Promotions sync (PromoFull XML)
- Product image enrichment
- Price history UI ("מחיר עלה")
- User "cheapest chain" recommendation engine
