# Design — Israeli Supermarket Product Catalog (PoC)

**Date:** 2026-05-25
**Phase:** Phase 2, first slice
**Author:** Claude + Avita (brainstorming session)
**Status:** Revised twice. Second pass tightened RPC security (search_path, GRANT/REVOKE), extension/Vault prerequisites, query guards, ranking, timeout risk, rollback completeness. Ready for plan.

---

## 1. Goal

Give the Shopping List app a real product catalog so that:
- **(A)** Typing an item name suggests real Israeli products with price, manufacturer, and unit size.
- **(B)** The list shows a running total ("סה״כ משוער: ₪137.40") based on the selected chain's prices.
- **(C)** *Future:* cross-chain price comparison for the same cart.

This PoC delivers A + B. C is explicitly deferred.

## 2. Data source

Israeli "Food Transparency Law" (חוק שקיפות מחירי המזון, 2014) requires ~35 retail chains to publish their full price catalogs daily as public XML feeds (e.g., `prices.rami-levy.co.il`). The PoC consumes **Rami Levy** only; schema is multi-chain-ready.

The MCP server `@skills-il/supermarket-prices-mcp` is a **development-time tool** for Claude — it wraps the same XML feeds. The production Edge Function re-implements the fetch/parse logic in Deno; MCP is not in the runtime path.

## 3. Scope

### In scope (PoC)
- New tables: `shopping.chains`, `shopping.products`, `shopping.product_prices`.
- One row in `chains`: `('rami-levy', 'רמי לוי')`.
- Full Rami Levy catalog imported (~30K products), refreshed daily.
- New column `shopping.list_items.barcode` (nullable, FK to products).
- Supabase Edge Function `refresh-products` — daily fetch, parse, normalize, upsert.
- `pg_cron` schedule: daily at a fixed UTC hour (accepts DST drift — see §5).
- Manual-trigger RPC `shopping.refresh_products_now()` (admin only) for debugging.
- `shopping.refresh_log` table for observability, including `rows_skipped` for hygiene rejects.
- `shopping.app_admins` table to gate admin-only RPCs (replaces email hard-coding).
- New RPC `shopping.search_products(p_query, p_chain_code, p_limit)` returns the shape the combobox needs (ranked by `pg_trgm` similarity).
- `AddItemInput.tsx` becomes a combobox with debounced autocomplete, fed by `search_products`.
- `add_item` RPC accepts optional `p_barcode`; returns a result row that includes `barcode_applied boolean` so the UI can toast "המוצר נוסף ללא מחיר" when a barcode lookup missed.
- Cart-total footer in `ItemList.tsx` showing sum of `estimated_price * qty` for items not yet in cart.

### Explicitly out of scope
- Chain selector UI (hard-coded to `rami-levy`).
- `user_preferences.preferred_chain` column.
- Cross-chain comparison feature (C).
- Edit qty/unit/price after add (separate gap, tracked in `HANDOFF.md`).
- Barcode camera scanning.
- Promotions data (`get_promotions` MCP tool is ignored for now).

## 4. Data model

New migration: `0005_products_catalog.sql`.

**Required extensions** (both must be enabled in the Supabase dashboard or installed by the migration):
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_net;     -- for net.http_post() from refresh_products_now
-- pg_cron is enabled separately via Supabase Dashboard → Database → Extensions
```

**Required Supabase Vault secrets / GUCs** (set once via dashboard or migration before rollout, **not** part of the migration file because they hold credentials):
- Vault secret `service_role_key` → the project's service-role JWT.
- Database setting `app.functions_url` → `https://xgihixrhosbxyloeoxnv.supabase.co/functions/v1` (set with `ALTER DATABASE postgres SET app.functions_url = '…'`).

If either is missing at runtime, `refresh_products_now` errors clearly instead of silently dropping the request — the Edge Function call inside the RPC will raise.

```sql

CREATE TABLE shopping.chains (
  code         text PRIMARY KEY,
  display_name text NOT NULL
);

CREATE TABLE shopping.products (
  barcode       text PRIMARY KEY,
  name          text NOT NULL,
  unit_qty      numeric,
  unit_measure  text,
  manufacturer  text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_name_trgm
  ON shopping.products USING gin (name gin_trgm_ops);

CREATE TABLE shopping.product_prices (
  barcode     text NOT NULL REFERENCES shopping.products(barcode) ON DELETE CASCADE,
  chain_code  text NOT NULL REFERENCES shopping.chains(code),
  price       numeric NOT NULL CHECK (price >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (barcode, chain_code)
);
CREATE INDEX product_prices_chain ON shopping.product_prices(chain_code);

CREATE TABLE shopping.refresh_log (
  id              bigserial PRIMARY KEY,
  chain_code      text NOT NULL REFERENCES shopping.chains(code),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  rows_upserted   integer,
  rows_skipped    integer,            -- malformed / blank-name / price<=0 rows
  triggered_by    text,                -- 'cron' | 'manual:<user_id>'
  error           text
);

CREATE TABLE shopping.app_admins (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shopping.list_items
  ADD COLUMN barcode text REFERENCES shopping.products(barcode);

INSERT INTO shopping.chains (code, display_name)
  VALUES ('rami-levy', 'רמי לוי');

-- bootstrap: Avita is the first admin. Done as a one-time INSERT, no email check in code.
INSERT INTO shopping.app_admins (user_id)
  SELECT id FROM auth.users WHERE email = 'avitantal@gmail.com'
  ON CONFLICT DO NOTHING;
```

### RLS policies
- `chains`, `products`, `product_prices`: `SELECT` allowed to `authenticated`; `INSERT/UPDATE/DELETE` restricted to `service_role` (Edge Function only).
- `refresh_log`: `SELECT` allowed to `authenticated` (debugging); writes are `service_role`-only.

### New RPC `shopping.search_products`
```sql
CREATE FUNCTION shopping.search_products(
  p_query      text,
  p_chain_code text DEFAULT 'rami-levy',
  p_limit      int  DEFAULT 8
) RETURNS TABLE(
  barcode      text,
  name         text,
  unit_qty     numeric,
  unit_measure text,
  manufacturer text,
  price        numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = shopping, public, extensions
AS $$
  WITH q AS (SELECT trim(p_query) AS s)
  SELECT p.barcode, p.name, p.unit_qty, p.unit_measure, p.manufacturer, pp.price
  FROM shopping.products p
  JOIN shopping.product_prices pp ON pp.barcode = p.barcode
  CROSS JOIN q
  WHERE length(q.s) >= 2                                  -- empty / single-char queries return nothing
    AND pp.chain_code = p_chain_code
    AND p.name ILIKE '%' || q.s || '%'
  ORDER BY
    CASE WHEN p.name ILIKE q.s || '%' THEN 0 ELSE 1 END,  -- prefix match wins
    similarity(p.name, q.s) DESC,                          -- then trigram similarity
    p.name ASC                                             -- stable tiebreak
  LIMIT GREATEST(LEAST(p_limit, 50), 1);
$$;
```
This decouples the UI from the underlying schema and lets us tune ranking server-side without a frontend change.

### Existing RPC `shopping.add_item` — updated signature
- Add optional 3rd parameter `p_barcode text DEFAULT NULL`.
- Return type changes from `void` to a row containing the inserted `list_items` id **and** a `barcode_applied boolean`.
- Behavior:
  1. If `p_barcode` is null → insert as free-text (today's behavior); `barcode_applied = false`.
  2. If `p_barcode` is non-null and found in `products` + `product_prices` (chain = `'rami-levy'`) → populate `barcode`, `estimated_price`, `unit_qty`, `unit_measure` from catalog; `barcode_applied = true`.
  3. If `p_barcode` is non-null but **not** found → insert as free-text (no error), `barcode_applied = false`. The UI uses this flag to surface a subtle toast: "המוצר נוסף ללא מחיר".

## 5. Backend — Edge Function `refresh-products`

**Location:** `supabase/functions/refresh-products/index.ts` (Deno).

**Flow:**
1. Insert row into `refresh_log` (chain='rami-levy', started_at=now(), triggered_by=…). Capture the returned `id` as `log_id`.
2. `fetch('https://prices.rami-levy.co.il/.../PriceFull-*.gz')`.
   - URL discovery: list-index XML is fetched first to find the latest `PriceFull` file.
3. Decompress gzip into memory (DecompressionStream).
4. **Parse the decompressed XML in one pass** with `npm:fast-xml-parser`. This is not a true streaming parser; for a 30K-row PriceFull file the parsed object stays well under Supabase Edge's 256MB memory ceiling. If catalogs grow beyond what fits in memory, swap to a SAX-style parser (`npm:sax`) — tracked as follow-up, not in PoC.
5. **Normalize each row** before upsert. Reject (and count under `rows_skipped`) any row that:
   - Has empty `ItemCode` / `ItemName`, or `ItemName` is purely numeric.
   - Has `ItemPrice <= 0` or non-numeric.
   - Has an `ItemCode` already seen in this run (duplicates → keep first, skip rest).
   Normalize: trim whitespace, collapse double spaces in `name`, coerce `manufacturer` to NULL when blank, normalize `unit_measure` to canonical Hebrew (e.g. `"ק\"ג" → "ק״ג"`).
6. Accumulate normalized rows into batches of 1000; for each batch:
   - `UPSERT` into `products` (on conflict `barcode` do update name, unit_qty, unit_measure, manufacturer, updated_at).
   - `UPSERT` into `product_prices` (on conflict `(barcode, chain_code)` do update price, updated_at).
7. On success: update `refresh_log[log_id]` with `finished_at`, `rows_upserted`, `rows_skipped`.
8. On failure: update `refresh_log[log_id]` with `error` and exit non-zero. Already-upserted batches remain (each batch is committed independently — partial refresh is better than none).

**Auth:** Function is deployed with `verify_jwt = true` (default). The cron caller passes `Authorization: Bearer <service_role>`. Manual invocations from `supabase functions invoke` use the project's service role implicitly. No anonymous invocation path.

**Scheduling:** `pg_cron` extension. `pg_cron` runs in UTC and does not honor `TIMEZONE`. We schedule at a fixed UTC hour and accept a 1-hour drift between Israeli standard time and Israeli summer time. The refresh runs in the small hours either way — drift is harmless for a daily catalog.
```sql
SELECT cron.schedule(
  'refresh-products-daily',
  '0 2 * * *',  -- 02:00 UTC: ~04:00 in IST (winter), ~05:00 in IDT (summer). Accepted drift.
  $$ SELECT net.http_post(
       url     := 'https://xgihixrhosbxyloeoxnv.supabase.co/functions/v1/refresh-products',
       headers := jsonb_build_object('Authorization', 'Bearer ' || vault.read_secret('service_role_key'))
     ); $$
);
```
(Service role key stored in Supabase Vault, not hard-coded.)

**Initial seed:** The very first run is the same Edge Function invoked manually:
```bash
supabase functions invoke refresh-products --project-ref xgihixrhosbxyloeoxnv
```
The function's idempotent UPSERT logic handles both initial seed and incremental refresh — one code path, no divergence.

**Manual trigger RPC** (for debugging):
```sql
CREATE FUNCTION shopping.refresh_products_now(p_chain_code text DEFAULT 'rami-levy')
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = shopping, public, extensions
AS $$
DECLARE
  v_log_id bigint;
BEGIN
  -- gate on admin table, not hard-coded email
  IF NOT EXISTS (SELECT 1 FROM shopping.app_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- create the refresh_log row up-front so the caller can poll it
  INSERT INTO shopping.refresh_log (chain_code, triggered_by)
    VALUES (p_chain_code, 'manual:' || auth.uid()::text)
    RETURNING id INTO v_log_id;

  -- fire-and-forget the Edge Function, passing the log_id so it updates the same row
  PERFORM net.http_post(
    url     := current_setting('app.functions_url') || '/refresh-products',
    headers := jsonb_build_object('Authorization', 'Bearer ' || vault.read_secret('service_role_key')),
    body    := jsonb_build_object('log_id', v_log_id, 'chain_code', p_chain_code)
  );
  RETURN v_log_id;
END $$;

-- Lock down execute privileges: PUBLIC has nothing, authenticated callers can invoke
-- (and the admin check inside the function gates further).
REVOKE ALL ON FUNCTION shopping.refresh_products_now(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shopping.refresh_products_now(text) TO authenticated;
```
The Edge Function checks for a `log_id` in its request body and, when present, updates that existing row instead of inserting a new one. This gives the manual caller a stable handle to poll for completion.

## 6. Frontend changes

### 6.1 `src/components/AddItemInput.tsx`

Becomes a controlled combobox:

```
┌─────────────────────────────────────────┐
│ הוסף פריט…                              │  ← existing input
├─────────────────────────────────────────┤
│ חלב תנובה 3% בקרטון · 1 ליטר · ₪6.90    │  ← results dropdown
│ חלב תנובה 1% בקרטון · 1 ליטר · ₪6.40    │
│ חלב סויה עלית · 1 ליטר · ₪9.90          │
└─────────────────────────────────────────┘
```

**Behavior:**
- 200ms debounce on input.
- Query: `db.rpc('search_products', { p_query: q, p_chain_code: 'rami-levy', p_limit: 8 })` — the RPC handles ranking server-side (`pg_trgm` similarity) and isolates the UI from schema changes.
- Arrow keys navigate; Enter on a highlighted row → add with barcode.
- Enter on the input with no row highlighted → free-text add (existing behavior).
- Esc closes the dropdown.
- Click outside closes the dropdown.
- Loading state: spinner inside the input while query in flight.
- Empty state: if query returns 0 rows after debounce, dropdown shows a single ghost row "הוסף '<query>' ללא מחיר" — Enter / click selects it (free-text path).

### 6.2 `add_item` RPC call

`useListItems.add` updated to:
- Pass `p_barcode` when an autocomplete row was selected; otherwise undefined.
- Inspect the returned `barcode_applied` flag. If the user selected a catalog row but `barcode_applied === false` (catalog miss between selection and insert — rare race), surface a subtle toast: **"המוצר נוסף ללא מחיר"**. No toast when no barcode was offered in the first place.

### 6.3 `src/components/ItemList.tsx` — cart-total footer

Sticky footer below the list:
- Computed client-side: `sum(item.estimated_price * item.qty)` over items where `is_in_cart === false` and `estimated_price != null`.
- Display: **`סה״כ משוער: ₪137.40`** — the "משוער" wording is intentional and conveys that the figure is approximate; we do not promise checkout accuracy.
- **Unit semantics:** `estimated_price` is the price per item-as-sold (a "1 ליטר חלב" carton at ₪6.90, a "5 ק״ג אורז" sack at ₪35). `qty` is the count of *those packages*. We do not attempt per-weight calculations for produce sold by weight (those will land in catalog with the package price as published; if a chain only publishes a `pricePerKg`, the row is skipped via §5 normalization).
- Edge cases:
  - All items lack `estimated_price` → footer hidden.
  - Some items lack `estimated_price` → footer shown with small "ⓘ" icon; tooltip: `"X פריטים ללא מחיר"`.
  - Empty list → footer hidden.

### 6.4 `src/components/ItemRow.tsx`

No visual change. Existing behavior of showing `estimated_price` when present is sufficient — autocomplete-added items will simply have the field populated.

## 7. Error handling

| Scenario | Behavior |
|---|---|
| Autocomplete query fails (network) | Dropdown shows "שגיאת רשת"; input still works for free-text. |
| `add_item` fails with barcode | Falls back to free-text; user sees the same error toast as today. |
| Edge Function fails mid-batch | `refresh_log.error` records the exception; existing catalog data unchanged (UPSERT is per-batch). |
| Edge Function timeout (>150s) | Logged as error; next daily run retries. PoC accepts up to 24h data staleness. **Risk:** initial seed of ~30K rows × 2 upserts per batch is borderline for the 150s wall clock; if hit, mitigation is to shrink batch size from 1000 → 500 or move bulk insert through a temp/staging table. Not pre-implemented; monitor `refresh_log` after first run. |
| `pg_cron` job fails | Visible in Supabase Dashboard → Database → cron jobs. No alerting in PoC. |
| Catalog row malformed (blank name, price≤0, dup barcode) | Skipped at normalization; counted in `refresh_log.rows_skipped`. No alert. |
| Catalog miss between autocomplete and add (race) | `add_item` returns `barcode_applied=false`; UI shows "המוצר נוסף ללא מחיר" toast; row inserted as free-text. |
| Non-admin calls `refresh_products_now` | `RAISE EXCEPTION 'not authorized'`; surfaced to UI as error toast. |

## 8. Testing

### Manual smoke
1. Run `supabase functions invoke refresh-products` locally → check `refresh_log` row finishes with `rows_upserted > 10000` **and** `rows_skipped < 5%` of total. A higher skip ratio signals upstream catalog change worth investigating.
2. Sign in to app, type "חלב" in add-item → dropdown shows ≥3 results within 500ms.
3. Select one → item added with price visible in `ItemRow`.
4. Add a 2nd item from autocomplete → footer shows correct sum.
5. Add a free-text item ("פטרוזיליה ביתי") → it appears without price; footer shows ⓘ icon.
6. As admin, call `select shopping.refresh_products_now()` → returns a `log_id`; polling `refresh_log` shows it transition from "started" to "finished".
7. As non-admin, call the same RPC → fails with "not authorized".

### Playwright (deferred)
The existing `e2e/sharing.spec.ts` setup is reused. New spec `e2e/catalog.spec.ts` covers steps 2–5 above. Listed as follow-up, not blocking PoC merge.

### Performance budget
- Autocomplete round-trip: p95 < 300ms on Hebrew query with ≥30K products.
- Trigram index makes `ILIKE '%word%'` fast enough at this scale.
- If p95 exceeds 300ms in practice → add full-text search column (deferred to follow-up).

## 9. Migration / rollout

1. Apply migration `0005_products_catalog.sql` to `xgihixrhosbxyloeoxnv`.
2. Deploy Edge Function `refresh-products`.
3. Invoke once manually → verify catalog populated.
4. Schedule via `pg_cron`.
5. Deploy frontend changes.
6. Bump `package.json` version → version label in UI auto-updates.

**Rollback:** Migration is purely additive (no existing column changed). To roll back: drop the 5 new tables (`chains`, `products`, `product_prices`, `refresh_log`, `app_admins`), drop the new column on `list_items` (nullable, never required), drop the 2 new RPCs (`search_products`, `refresh_products_now`), unschedule the cron job, undeploy the Edge Function, revert frontend. No data loss in existing `list_items` rows.

## 10. Future work (not in this PoC)

- **Cross-chain comparison (C):** add 2-3 more chains in `chains` table; UI toggle between chains; "compare prices" button on the list.
- **`user_preferences.preferred_chain`:** per-user default chain.
- **Promotions:** consume `get_promotions` MCP tool / equivalent XML feed; show "במבצע!" badge.
- **Barcode camera scan:** mobile-only; uses ZXing or similar lib.
- **Full-text search column** if trigram performance is insufficient.
- **Catalog freshness indicator:** "מחירים עודכנו לפני 3 שעות" in the footer, based on `refresh_log`.
- **True streaming XML parser** (`npm:sax`) when catalog size grows past Edge memory limits.
- **DST-aware scheduling** if 04:00↔05:00 local drift becomes a real concern.
- **Per-weight produce pricing** (`pricePerKg` * weight) for fresh produce that chains publish that way.
