# Product Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Israeli Food Transparency Law price feed (Rami Levy only) into the Shopping List app so the add-item field becomes a real product autocomplete with prices, and the list shows a running cart total.

**Architecture:** New `shopping.products` / `shopping.product_prices` / `shopping.refresh_log` / `shopping.app_admins` tables, fed daily by a Supabase Edge Function (`refresh-products`) over `pg_cron`. UI gets a debounced combobox backed by an `RPC search_products` (pg_trgm ranked), the `add_item` RPC is extended with optional `p_barcode`, and a sticky cart-total footer sums `estimated_price * qty`.

**Tech Stack:** Postgres (`pg_trgm`, `pg_net`, `pg_cron`), Supabase Edge Functions (Deno + `npm:fast-xml-parser`), Supabase Vault for the service-role key, React 19 + TypeScript + Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-25-product-catalog-design.md`

**Supabase project:** `xgihixrhosbxyloeoxnv` (schemas: `shopping`). All migration / SQL operations go through the `claude.ai Supabase` MCP with that project_id.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/0005_products_catalog.sql` | create | All schema, RLS, RPCs for this feature |
| `supabase/functions/refresh-products/deno.json` | create | Deno import map for the Edge Function |
| `supabase/functions/refresh-products/parser.ts` | create | `parsePriceFull(xmlString)` + `normalizeRow()`, pure functions (unit-testable) |
| `supabase/functions/refresh-products/parser_test.ts` | create | Deno tests for parser/normalize |
| `supabase/functions/refresh-products/index.ts` | create | Main HTTP handler — fetch, decompress, parse, upsert, log |
| `src/lib/supabase.ts` | modify | Add `Product`, `SearchProductResult`, extend `ListItem.barcode` |
| `src/hooks/useProductSearch.ts` | create | Debounced search hook calling `search_products` RPC |
| `src/hooks/useListItems.ts` | modify | `addItem` accepts barcode, surfaces `barcode_applied` |
| `src/components/AddItemInput.tsx` | modify | Free-text input → combobox with dropdown |
| `src/components/CartTotalFooter.tsx` | create | Sticky footer; sums estimated prices |
| `src/components/ActiveList.tsx` | modify | Render `CartTotalFooter` under the list |
| `src/test/hooks/useProductSearch.test.ts` | create | Hook tests (debounce, RPC call, results) |
| `src/test/components/AddItemInput.test.tsx` | create | Combobox keyboard/mouse interaction tests |
| `src/test/components/CartTotalFooter.test.tsx` | create | Sum + edge cases (empty, partial, all unpriced) |
| `package.json` | modify | Version bump 0.11.3 → 0.12.0 |
| `HANDOFF.md` | modify | Update Phase-2 status |

---

## Phase A — Database

### Task A1: Create migration file with tables, extensions, RLS, and bootstrap

**Files:**
- Create: `supabase/migrations/0005_products_catalog.sql`

- [ ] **Step 1: Create the migration file with extensions + tables**

Write to `supabase/migrations/0005_products_catalog.sql`:

```sql
-- =====================================================================
-- 0005 — Product catalog from Israeli Food Transparency Law feeds.
-- See docs/superpowers/specs/2026-05-25-product-catalog-design.md
-- =====================================================================

create extension if not exists pg_trgm;
create extension if not exists pg_net;
-- pg_cron is enabled via Supabase Dashboard → Database → Extensions (separate step).

-- ----- Reference tables ---------------------------------------------

create table if not exists shopping.chains (
  code         text primary key,
  display_name text not null
);

create table if not exists shopping.products (
  barcode       text primary key,
  name          text not null,
  unit_qty      numeric,
  unit_measure  text,
  manufacturer  text,
  updated_at    timestamptz not null default now()
);
create index if not exists products_name_trgm
  on shopping.products using gin (name gin_trgm_ops);

create table if not exists shopping.product_prices (
  barcode     text not null references shopping.products(barcode) on delete cascade,
  chain_code  text not null references shopping.chains(code),
  price       numeric not null check (price >= 0),
  updated_at  timestamptz not null default now(),
  primary key (barcode, chain_code)
);
create index if not exists product_prices_chain on shopping.product_prices(chain_code);

create table if not exists shopping.refresh_log (
  id              bigserial primary key,
  chain_code      text not null references shopping.chains(code),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  rows_upserted   integer,
  rows_skipped    integer,
  triggered_by    text,          -- 'cron' | 'manual:<user_id>'
  error           text
);

create table if not exists shopping.app_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- ----- list_items.barcode column ------------------------------------

alter table shopping.list_items
  add column if not exists barcode text references shopping.products(barcode);

-- ----- Reference data + admin bootstrap -----------------------------

insert into shopping.chains (code, display_name)
  values ('rami-levy', 'רמי לוי')
  on conflict (code) do nothing;

insert into shopping.app_admins (user_id)
  select id from auth.users where email = 'avitantal@gmail.com'
  on conflict do nothing;

-- ----- RLS ----------------------------------------------------------

alter table shopping.chains          enable row level security;
alter table shopping.products        enable row level security;
alter table shopping.product_prices  enable row level security;
alter table shopping.refresh_log     enable row level security;
alter table shopping.app_admins      enable row level security;

-- Read-only for any authenticated user; writes are service_role only
-- (service_role bypasses RLS, so no explicit write policy is needed).
create policy chains_read         on shopping.chains         for select to authenticated using (true);
create policy products_read       on shopping.products       for select to authenticated using (true);
create policy product_prices_read on shopping.product_prices for select to authenticated using (true);
create policy refresh_log_read    on shopping.refresh_log    for select to authenticated using (true);

-- app_admins: each user can see whether *they* are an admin; no one else.
create policy app_admins_self on shopping.app_admins
  for select to authenticated using (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `claude.ai Supabase` MCP `apply_migration` tool with:
- `project_id: xgihixrhosbxyloeoxnv`
- `name: 0005_products_catalog`
- `query`: the contents of the file written in Step 1

- [ ] **Step 3: Verify tables, indexes, and policies exist**

Run via `execute_sql` MCP tool:

```sql
select table_name from information_schema.tables
 where table_schema = 'shopping'
   and table_name in ('chains','products','product_prices','refresh_log','app_admins')
 order by table_name;
```
Expected: 5 rows.

```sql
select indexname from pg_indexes
 where schemaname = 'shopping'
   and indexname in ('products_name_trgm','product_prices_chain');
```
Expected: 2 rows.

```sql
select rolname || ' can read' as ok
  from pg_policies where schemaname = 'shopping'
   and tablename = 'products' and policyname = 'products_read';
```
Expected: 1 row.

- [ ] **Step 4: Verify reference + bootstrap data**

```sql
select code, display_name from shopping.chains;
```
Expected: one row `('rami-levy','רמי לוי')`.

```sql
select count(*) as admin_count from shopping.app_admins;
```
Expected: 1 (if Avita already has an account on this project; 0 if not — that's fine, will be inserted after first sign-in if needed).

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/migrations/0005_products_catalog.sql
git commit -m "feat(db): add product catalog tables, indexes, RLS, and admin bootstrap"
```

---

### Task A2: Add the three RPCs to migration file

**Files:**
- Modify: `supabase/migrations/0005_products_catalog.sql`

- [ ] **Step 1: Append search_products RPC to migration file**

Append to the bottom of `supabase/migrations/0005_products_catalog.sql`:

```sql
-- =====================================================================
-- RPC: search_products — fuzzy lookup for the autocomplete UI.
-- =====================================================================
create or replace function shopping.search_products(
  p_query      text,
  p_chain_code text default 'rami-levy',
  p_limit      int  default 8
) returns table(
  barcode      text,
  name         text,
  unit_qty     numeric,
  unit_measure text,
  manufacturer text,
  price        numeric
)
language sql stable security invoker
set search_path = shopping, public, extensions
as $$
  with q as (select trim(p_query) as s)
  select p.barcode, p.name, p.unit_qty, p.unit_measure, p.manufacturer, pp.price
  from shopping.products p
  join shopping.product_prices pp on pp.barcode = p.barcode
  cross join q
  where length(q.s) >= 2
    and pp.chain_code = p_chain_code
    and p.name ilike '%' || q.s || '%'
  order by
    case when p.name ilike q.s || '%' then 0 else 1 end,
    similarity(p.name, q.s) desc,
    p.name asc
  limit greatest(least(p_limit, 50), 1);
$$;

grant execute on function shopping.search_products(text, text, int) to authenticated;
```

- [ ] **Step 2: Apply this chunk via execute_sql**

Run via `execute_sql` MCP tool with just the SQL block from Step 1 (the `create or replace` is idempotent so re-running is safe).

- [ ] **Step 3: Verify the RPC behaves correctly even on empty catalog**

```sql
-- short query → 0 rows
select count(*) from shopping.search_products('a');
-- empty query → 0 rows
select count(*) from shopping.search_products('');
-- normal query on empty catalog → 0 rows (no error)
select count(*) from shopping.search_products('חלב');
```
Expected: all return 0.

- [ ] **Step 4: Append the updated add_item RPC**

First locate the existing `add_item` definition to keep the signature compatible. Use `execute_sql`:

```sql
select pg_get_functiondef(p.oid) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'shopping' and p.proname = 'add_item';
```

Then append to `supabase/migrations/0005_products_catalog.sql`:

```sql
-- =====================================================================
-- RPC: add_item (extended) — accepts optional p_barcode and returns
-- both the new row's id and a barcode_applied flag.
-- Drop the prior signature to allow changing the return type.
-- =====================================================================
drop function if exists shopping.add_item(uuid, text, numeric, text);

create or replace function shopping.add_item(
  p_list_id uuid,
  p_name    text,
  p_qty     numeric default 1,
  p_unit    text    default null,
  p_barcode text    default null
) returns table(item_id uuid, barcode_applied boolean)
language plpgsql security definer
set search_path = shopping, public, auth
as $$
declare
  v_uid       uuid := auth.uid();
  v_price     numeric;
  v_unit_qty  numeric;
  v_unit      text;
  v_applied   boolean := false;
  v_id        uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  if p_barcode is not null then
    select pp.price, p.unit_qty, p.unit_measure
      into v_price, v_unit_qty, v_unit
      from shopping.products p
      join shopping.product_prices pp on pp.barcode = p.barcode
      where p.barcode = p_barcode and pp.chain_code = 'rami-levy';
    v_applied := found;
  end if;

  insert into shopping.list_items
    (list_id, name, qty, unit, estimated_price, barcode, created_by)
  values
    (p_list_id, p_name,
     coalesce(p_qty, 1),
     coalesce(p_unit, v_unit),
     v_price,
     case when v_applied then p_barcode else null end,
     v_uid)
  returning id into v_id;

  return query select v_id, v_applied;
end $$;

grant execute on function shopping.add_item(uuid, text, numeric, text, text) to authenticated;
```

- [ ] **Step 5: Apply the add_item chunk via execute_sql**

Use `execute_sql` MCP to run the SQL from Step 4. If it fails because the existing `add_item` has a different signature than `(uuid, text, numeric, text)`, fetch the real signature with the query in Step 4 and adapt the `drop function` line accordingly. Do not edit the saved migration file until the apply succeeds.

- [ ] **Step 6: Verify add_item works**

```sql
-- pick a real list owned by Avita
select id, name from shopping.shopping_lists
 where owner_id = (select id from auth.users where email = 'avitantal@gmail.com')
 limit 1;
```

Then with that list id, run:

```sql
-- free-text path: barcode_applied = false, no price
select * from shopping.add_item(
  '<list_id>'::uuid, 'בדיקה — חופשי', 1, null, null
);
-- catalog-miss path: same outcome (no products in catalog yet)
select * from shopping.add_item(
  '<list_id>'::uuid, 'בדיקה — מיס', 1, null, '0000000000000'
);
-- clean up the test rows
delete from shopping.list_items where name like 'בדיקה — %';
```
Expected: both return `barcode_applied = false`. The catalog-miss row has NULL `barcode` and NULL `estimated_price`.

- [ ] **Step 7: Append refresh_products_now RPC**

Append to `supabase/migrations/0005_products_catalog.sql`:

```sql
-- =====================================================================
-- RPC: refresh_products_now — admin-only manual trigger for debugging.
-- Inserts a refresh_log row up-front so the caller can poll it, then
-- fires-and-forgets the Edge Function (which updates the same row).
-- =====================================================================
create or replace function shopping.refresh_products_now(p_chain_code text default 'rami-levy')
  returns bigint
  language plpgsql
  security definer
  set search_path = shopping, public, extensions
as $$
declare
  v_log_id bigint;
begin
  if not exists (select 1 from shopping.app_admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  insert into shopping.refresh_log (chain_code, triggered_by)
    values (p_chain_code, 'manual:' || coalesce(auth.uid()::text, 'unknown'))
    returning id into v_log_id;

  perform net.http_post(
    url     := current_setting('app.functions_url') || '/refresh-products',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
                 'Content-Type', 'application/json'
               ),
    body    := jsonb_build_object('log_id', v_log_id, 'chain_code', p_chain_code)
  );
  return v_log_id;
end $$;

revoke all on function shopping.refresh_products_now(text) from public;
grant execute on function shopping.refresh_products_now(text) to authenticated;
```

Note: the RPC reads `app.service_role_key` via `current_setting()` rather than `vault.read_secret` for portability (Supabase Vault API changed across versions). The GUC will be set in Task C1.

- [ ] **Step 8: Apply via execute_sql**

Use `execute_sql` MCP to run the SQL from Step 7.

- [ ] **Step 9: Verify the admin gate**

```sql
-- as a non-admin (anon) — must fail
set local role anon;
select shopping.refresh_products_now();   -- expect: ERROR not authorized
reset role;
```

The admin path can't be smoke-tested until the Edge Function is deployed (Task B4); we verify the gate only.

- [ ] **Step 10: Commit the migration file**

```bash
git add supabase/migrations/0005_products_catalog.sql
git commit -m "feat(db): add search_products, refresh_products_now, and extend add_item RPCs"
```

---

## Phase B — Edge Function `refresh-products`

### Task B1: Scaffold the function directory and Deno config

**Files:**
- Create: `supabase/functions/refresh-products/deno.json`

- [ ] **Step 1: Create deno.json**

Write to `supabase/functions/refresh-products/deno.json`:

```json
{
  "imports": {
    "fast-xml-parser": "npm:fast-xml-parser@4.5.0",
    "supabase-js": "https://esm.sh/@supabase/supabase-js@2.45.4"
  },
  "tasks": {
    "test": "deno test --allow-net --allow-env --allow-read"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/refresh-products/deno.json
git commit -m "chore(edge): scaffold refresh-products Deno config"
```

---

### Task B2: Implement parser + normalization (TDD)

**Files:**
- Create: `supabase/functions/refresh-products/parser_test.ts`
- Create: `supabase/functions/refresh-products/parser.ts`

- [ ] **Step 1: Write the failing parser tests**

Write to `supabase/functions/refresh-products/parser_test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePriceFull, normalizeRow, type RawItem } from "./parser.ts";

const FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<Root>
  <Items>
    <Item>
      <ItemCode>7290000000001</ItemCode>
      <ItemName>חלב תנובה 3% בקרטון  1 ליטר</ItemName>
      <ManufacturerName>תנובה</ManufacturerName>
      <Quantity>1</Quantity>
      <UnitOfMeasure>ליטר</UnitOfMeasure>
      <ItemPrice>6.90</ItemPrice>
    </Item>
    <Item>
      <ItemCode>7290000000002</ItemCode>
      <ItemName></ItemName>
      <ItemPrice>5.00</ItemPrice>
    </Item>
    <Item>
      <ItemCode></ItemCode>
      <ItemName>אין-ברקוד</ItemName>
      <ItemPrice>5.00</ItemPrice>
    </Item>
    <Item>
      <ItemCode>7290000000004</ItemCode>
      <ItemName>חינם</ItemName>
      <ItemPrice>0</ItemPrice>
    </Item>
    <Item>
      <ItemCode>7290000000001</ItemCode>
      <ItemName>חלב כפול</ItemName>
      <ItemPrice>7.00</ItemPrice>
    </Item>
  </Items>
</Root>`;

Deno.test("parsePriceFull returns one entry per <Item>", () => {
  const raw = parsePriceFull(FIXTURE);
  assertEquals(raw.length, 5);
});

Deno.test("normalizeRow keeps a good row", () => {
  const raw: RawItem = {
    ItemCode: "7290000000001",
    ItemName: "חלב תנובה 3% בקרטון  1 ליטר",
    ManufacturerName: "תנובה",
    Quantity: "1",
    UnitOfMeasure: "ליטר",
    ItemPrice: "6.90",
  };
  const r = normalizeRow(raw, new Set());
  if (!r.ok) throw new Error("expected ok");
  assertEquals(r.row.barcode, "7290000000001");
  assertEquals(r.row.name, "חלב תנובה 3% בקרטון 1 ליטר"); // collapsed double space
  assertEquals(r.row.price, 6.9);
  assertEquals(r.row.unit_qty, 1);
  assertEquals(r.row.unit_measure, "ליטר");
});

Deno.test("normalizeRow rejects blank ItemName", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "", ItemPrice: "5" }, new Set());
  assertEquals(r.ok, false);
});

Deno.test("normalizeRow rejects empty ItemCode", () => {
  const r = normalizeRow({ ItemCode: "", ItemName: "x", ItemPrice: "5" }, new Set());
  assertEquals(r.ok, false);
});

Deno.test("normalizeRow rejects price <= 0", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "0" }, new Set());
  assertEquals(r.ok, false);
  const r2 = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "not-a-number" }, new Set());
  assertEquals(r2.ok, false);
});

Deno.test("normalizeRow rejects purely numeric name", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "12345", ItemPrice: "5" }, new Set());
  assertEquals(r.ok, false);
});

Deno.test("normalizeRow rejects duplicate barcode within run", () => {
  const seen = new Set<string>();
  const a = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "5" }, seen);
  assertEquals(a.ok, true);
  const b = normalizeRow({ ItemCode: "1", ItemName: "y", ItemPrice: "5" }, seen);
  assertEquals(b.ok, false);
});

Deno.test("normalizeRow coerces blank manufacturer to null", () => {
  const r = normalizeRow({ ItemCode: "1", ItemName: "x", ItemPrice: "5", ManufacturerName: "  " }, new Set());
  if (!r.ok) throw new Error("expected ok");
  assertEquals(r.row.manufacturer, null);
});
```

- [ ] **Step 2: Run tests to verify they fail (parser.ts doesn't exist yet)**

```bash
deno test supabase/functions/refresh-products/parser_test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parser.ts**

Write to `supabase/functions/refresh-products/parser.ts`:

```typescript
import { XMLParser } from "fast-xml-parser";

export interface RawItem {
  ItemCode?: string | number;
  ItemName?: string;
  ManufacturerName?: string;
  Quantity?: string | number;
  UnitOfMeasure?: string;
  ItemPrice?: string | number;
}

export interface NormalizedRow {
  barcode: string;
  name: string;
  unit_qty: number | null;
  unit_measure: string | null;
  manufacturer: string | null;
  price: number;
}

export type NormalizeResult =
  | { ok: true; row: NormalizedRow }
  | { ok: false; reason: string };

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,        // keep strings; we coerce manually
  trimValues: true,
});

export function parsePriceFull(xml: string): RawItem[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  // Schema varies slightly across chains; accept Root>Items>Item or Items>Item.
  const root = (doc.Root ?? doc.root ?? doc) as Record<string, unknown>;
  const items = (root.Items ?? (root as Record<string, unknown>).items) as
    | { Item?: RawItem | RawItem[] }
    | undefined;
  if (!items?.Item) return [];
  return Array.isArray(items.Item) ? items.Item : [items.Item];
}

function trimOrEmpty(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  return v.trim();
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function toNumberOrNaN(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function normalizeRow(raw: RawItem, seen: Set<string>): NormalizeResult {
  const barcode = trimOrEmpty(raw.ItemCode);
  if (!barcode) return { ok: false, reason: "empty barcode" };
  if (seen.has(barcode)) return { ok: false, reason: "duplicate barcode" };

  const nameRaw = trimOrEmpty(raw.ItemName);
  if (!nameRaw) return { ok: false, reason: "empty name" };
  if (/^\d+$/.test(nameRaw)) return { ok: false, reason: "numeric-only name" };

  const price = toNumberOrNaN(raw.ItemPrice);
  if (!(price > 0)) return { ok: false, reason: "price <= 0 or non-numeric" };

  const unitQtyN = toNumberOrNaN(raw.Quantity);
  const manufacturerRaw = trimOrEmpty(raw.ManufacturerName);

  seen.add(barcode);
  return {
    ok: true,
    row: {
      barcode,
      name: collapseSpaces(nameRaw),
      unit_qty: Number.isFinite(unitQtyN) ? unitQtyN : null,
      unit_measure: trimOrEmpty(raw.UnitOfMeasure) || null,
      manufacturer: manufacturerRaw || null,
      price,
    },
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
deno test supabase/functions/refresh-products/parser_test.ts
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/refresh-products/parser.ts supabase/functions/refresh-products/parser_test.ts
git commit -m "feat(edge): add PriceFull XML parser + row normalization with tests"
```

---

### Task B3: Implement Edge Function main flow

**Files:**
- Create: `supabase/functions/refresh-products/index.ts`

- [ ] **Step 1: Write the main handler**

Write to `supabase/functions/refresh-products/index.ts`:

```typescript
import { createClient } from "supabase-js";
import { parsePriceFull, normalizeRow, type NormalizedRow } from "./parser.ts";

// Hard-coded chain catalog for the PoC; replace with a DB lookup when adding
// more chains.
const CHAINS: Record<string, { indexUrl: string }> = {
  "rami-levy": {
    // The chain publishes a directory index; we resolve the latest PriceFull
    // file at runtime.
    indexUrl: "https://prices.rami-levy.co.il/",
  },
};

const BATCH_SIZE = 1000;

interface Body {
  log_id?: number;
  chain_code?: string;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const body: Body = await req.json().catch(() => ({}));
  const chainCode = body.chain_code ?? "rami-levy";
  const cfg = CHAINS[chainCode];
  if (!cfg) return json({ error: `unknown chain ${chainCode}` }, 400);

  // 1. Open / reuse refresh_log row
  let logId = body.log_id;
  if (!logId) {
    const { data, error } = await supabase
      .schema("shopping")
      .from("refresh_log")
      .insert({ chain_code: chainCode, triggered_by: "cron" })
      .select("id")
      .single();
    if (error) return json({ error: error.message }, 500);
    logId = data.id;
  }

  try {
    // 2. Resolve + fetch the latest PriceFull
    const xmlText = await fetchLatestPriceFull(cfg.indexUrl);

    // 3. Parse + normalize
    const raw = parsePriceFull(xmlText);
    const seen = new Set<string>();
    let skipped = 0;
    const good: NormalizedRow[] = [];
    for (const r of raw) {
      const n = normalizeRow(r, seen);
      if (!n.ok) { skipped++; continue; }
      good.push(n.row);
    }

    // 4. Upsert in batches
    let upserted = 0;
    for (let i = 0; i < good.length; i += BATCH_SIZE) {
      const chunk = good.slice(i, i + BATCH_SIZE);

      const { error: pErr } = await supabase
        .schema("shopping")
        .from("products")
        .upsert(
          chunk.map((r) => ({
            barcode: r.barcode,
            name: r.name,
            unit_qty: r.unit_qty,
            unit_measure: r.unit_measure,
            manufacturer: r.manufacturer,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "barcode" },
        );
      if (pErr) throw pErr;

      const { error: ppErr } = await supabase
        .schema("shopping")
        .from("product_prices")
        .upsert(
          chunk.map((r) => ({
            barcode: r.barcode,
            chain_code: chainCode,
            price: r.price,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "barcode,chain_code" },
        );
      if (ppErr) throw ppErr;

      upserted += chunk.length;
    }

    // 5. Finish
    await supabase
      .schema("shopping")
      .from("refresh_log")
      .update({
        finished_at: new Date().toISOString(),
        rows_upserted: upserted,
        rows_skipped: skipped,
      })
      .eq("id", logId);

    return json({ log_id: logId, rows_upserted: upserted, rows_skipped: skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .schema("shopping")
      .from("refresh_log")
      .update({ finished_at: new Date().toISOString(), error: msg })
      .eq("id", logId);
    return json({ log_id: logId, error: msg }, 500);
  }
});

async function fetchLatestPriceFull(indexUrl: string): Promise<string> {
  // Step 1: list files from the index. Rami Levy publishes a JSON-ish HTML
  // page; we grep for the most recent PriceFull-*.gz href.
  const indexHtml = await (await fetch(indexUrl, { redirect: "follow" })).text();
  const match = indexHtml.match(/href="(PriceFull[^"]+\.gz)"/i);
  if (!match) throw new Error("PriceFull file not found in index");
  const fileUrl = new URL(match[1], indexUrl).toString();

  // Step 2: download + gunzip
  const resp = await fetch(fileUrl, { redirect: "follow" });
  if (!resp.ok || !resp.body) throw new Error(`fetch ${fileUrl} -> ${resp.status}`);
  const decompressed = resp.body.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(decompressed).text();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Type-check via deno check**

```bash
deno check supabase/functions/refresh-products/index.ts
```
Expected: PASS (no type errors). If Rami Levy's index URL pattern doesn't match the regex, fix the regex now (run the URL through curl, look at the response, refine).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/refresh-products/index.ts
git commit -m "feat(edge): refresh-products handler — fetch, decompress, parse, upsert"
```

---

### Task B4: Deploy Edge Function and seed catalog

**Files:** none (deployment + verification only)

- [ ] **Step 1: Deploy the function via Supabase MCP**

Use `deploy_edge_function` MCP tool:
- `project_id: xgihixrhosbxyloeoxnv`
- `name: refresh-products`
- `files`: include `index.ts`, `parser.ts`, `deno.json`

- [ ] **Step 2: Invoke once to seed the catalog**

The function expects no auth body for cron-mode invocation; the service-role auth header is supplied by the MCP. From a shell, or via `execute_sql` with `net.http_post`:

```sql
select net.http_post(
  url := (select current_setting('app.functions_url')) || '/refresh-products',
  headers := jsonb_build_object(
              'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
              'Content-Type', 'application/json'),
  body := '{}'::jsonb
) as request_id;
```

If `app.functions_url` / `app.service_role_key` GUCs aren't set yet, set them now via:

```sql
alter database postgres set app.functions_url = 'https://xgihixrhosbxyloeoxnv.supabase.co/functions/v1';
alter database postgres set app.service_role_key = '<service-role-key-from-supabase-dashboard>';
-- Apply to the current session as well:
select set_config('app.functions_url',     'https://xgihixrhosbxyloeoxnv.supabase.co/functions/v1', false);
select set_config('app.service_role_key',  '<service-role-key-from-supabase-dashboard>', false);
```

The service-role key is **secret**: do not commit it; it lives only in Supabase project settings.

- [ ] **Step 3: Wait and check the refresh_log row**

Poll every ~20 seconds:

```sql
select id, started_at, finished_at, rows_upserted, rows_skipped, error
  from shopping.refresh_log
  order by id desc limit 1;
```
Expected: within 2 minutes, `finished_at` is non-null, `rows_upserted > 10000`, `rows_skipped < 5%` of total, `error` is null.

If `error` is non-null: inspect, fix Edge Function or parser, redeploy via Step 1, re-invoke via Step 2.

- [ ] **Step 4: Spot-check the catalog**

```sql
select count(*) as products            from shopping.products;
select count(*) as prices              from shopping.product_prices where chain_code = 'rami-levy';
select barcode, name, price from shopping.products p
  join shopping.product_prices pp on pp.barcode = p.barcode
  where p.name ilike '%חלב%' limit 5;
```
Expected: products and prices counts > 10000; ≥3 rows for the חלב search.

- [ ] **Step 5: Verify search_products now returns results**

```sql
select name, price from shopping.search_products('חלב');
```
Expected: ≤8 rows, prefix matches first.

---

## Phase C — pg_cron schedule

### Task C1: Enable pg_cron and schedule the daily refresh

**Files:** none (DB configuration only)

- [ ] **Step 1: Enable pg_cron in Supabase Dashboard**

Open the Supabase Dashboard → Database → Extensions → search `pg_cron` → enable. (Cannot be done via SQL on Supabase managed DB.)

- [ ] **Step 2: Schedule the daily run**

```sql
select cron.schedule(
  'refresh-products-daily',
  '0 2 * * *',
  $$
  select net.http_post(
    url := current_setting('app.functions_url') || '/refresh-products',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
                 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 3: Verify the schedule exists**

```sql
select jobname, schedule, command from cron.job where jobname = 'refresh-products-daily';
```
Expected: 1 row.

- [ ] **Step 4: Verify the manual RPC end-to-end (admin path)**

In the SQL editor (which runs as your authenticated user):

```sql
select shopping.refresh_products_now();
```
Expected: returns a bigint `log_id`. Poll `refresh_log` until that row's `finished_at` becomes non-null and `error` is null.

---

## Phase D — Frontend

### Task D1: Extend supabase.ts with new types

**Files:**
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Add Product and SearchProductResult, extend ListItem**

Edit `src/lib/supabase.ts`. In the `ListItem` interface, add:

```typescript
  barcode: string | null;
```

After the `ListItem` interface, add:

```typescript
export interface Product {
  barcode: string;
  name: string;
  unit_qty: number | null;
  unit_measure: string | null;
  manufacturer: string | null;
}

export interface SearchProductResult extends Product {
  price: number;
}
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(types): add Product + SearchProductResult; extend ListItem with barcode"
```

---

### Task D2: useProductSearch hook (TDD)

**Files:**
- Create: `src/test/hooks/useProductSearch.test.ts`
- Create: `src/hooks/useProductSearch.ts`

- [ ] **Step 1: Write the failing hook tests**

Write to `src/test/hooks/useProductSearch.test.ts`:

```typescript
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductSearch } from '../../hooks/useProductSearch';

const rpcMock = vi.fn();

vi.mock('../../lib/supabase', () => ({
  db: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('useProductSearch', () => {
  it('does not call RPC for queries shorter than 2 chars', () => {
    const { result } = renderHook(() => useProductSearch(''));
    expect(result.current.results).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('debounces and calls search_products with trimmed query', async () => {
    const { rerender } = renderHook(({ q }) => useProductSearch(q), {
      initialProps: { q: '' },
    });
    rerender({ q: 'ח' });
    rerender({ q: 'חל' });
    rerender({ q: 'חלב ' });
    act(() => { vi.advanceTimersByTime(199); });
    expect(rpcMock).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('search_products', {
      p_query: 'חלב',
      p_chain_code: 'rami-levy',
      p_limit: 8,
    });
  });

  it('exposes returned rows as results', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ barcode: '1', name: 'חלב', unit_qty: 1, unit_measure: 'ליטר', manufacturer: 'תנובה', price: 6.9 }],
      error: null,
    });
    const { result } = renderHook(() => useProductSearch('חלב'));
    act(() => { vi.advanceTimersByTime(201); });
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.results[0].barcode).toBe('1');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test:run -- useProductSearch
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Write to `src/hooks/useProductSearch.ts`:

```typescript
import { useEffect, useState } from 'react';
import { db, type SearchProductResult } from '../lib/supabase';

const DEBOUNCE_MS = 200;
const MIN_LEN = 2;

export function useProductSearch(query: string, chainCode = 'rami-levy', limit = 8) {
  const [results, setResults] = useState<SearchProductResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_LEN) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const { data, error } = await db.rpc('search_products', {
        p_query: trimmed,
        p_chain_code: chainCode,
        p_limit: limit,
      });
      if (cancelled) return;
      setResults(error ? [] : (data ?? []) as SearchProductResult[]);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => { cancelled = true; window.clearTimeout(t); };
  }, [query, chainCode, limit]);

  return { results, loading };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm run test:run -- useProductSearch
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProductSearch.ts src/test/hooks/useProductSearch.test.ts
git commit -m "feat(hooks): useProductSearch with debounce + min-length guard"
```

---

### Task D3: Combobox in AddItemInput

**Files:**
- Modify: `src/components/AddItemInput.tsx`
- Create: `src/test/components/AddItemInput.test.tsx`

- [ ] **Step 1: Write tests for combobox behavior**

Write to `src/test/components/AddItemInput.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddItemInput } from '../../components/AddItemInput';

const rpcMock = vi.fn();
vi.mock('../../lib/supabase', () => ({
  db: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({
    data: [
      { barcode: '1', name: 'חלב תנובה 3%', unit_qty: 1, unit_measure: 'ליטר', manufacturer: 'תנובה', price: 6.9 },
      { barcode: '2', name: 'חלב סויה',    unit_qty: 1, unit_measure: 'ליטר', manufacturer: null,    price: 9.9 },
    ],
    error: null,
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('AddItemInput combobox', () => {
  it('free-text submit calls onAdd with name only (no barcode)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddItemInput onAdd={onAdd} />);
    const input = screen.getByPlaceholderText(/הוסף פריט/);
    await userEvent.type(input, 'משהו ייחודי{Enter}');
    expect(onAdd).toHaveBeenCalledWith('משהו ייחודי', undefined);
  });

  it('selecting a row calls onAdd with that row\'s barcode', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddItemInput onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(/הוסף פריט/), 'חלב');
    await waitFor(() => expect(screen.getByText(/חלב תנובה 3%/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/חלב תנובה 3%/));
    expect(onAdd).toHaveBeenCalledWith('חלב תנובה 3%', '1');
  });

  it('Esc closes the dropdown', async () => {
    render(<AddItemInput onAdd={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/הוסף פריט/), 'חלב');
    await waitFor(() => expect(screen.getByText(/חלב תנובה 3%/)).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/חלב תנובה 3%/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- AddItemInput
```
Expected: FAIL.

- [ ] **Step 3: Rewrite AddItemInput as a combobox**

Replace `src/components/AddItemInput.tsx` with:

```typescript
import { Plus } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useProductSearch } from '../hooks/useProductSearch';

interface Props {
  onAdd: (name: string, barcode?: string) => Promise<void> | void;
}

export function AddItemInput({ onAdd }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const { results } = useProductSearch(name);

  async function add(value: string, barcode?: string) {
    if (!value) return;
    setBusy(true);
    try {
      await onAdd(value, barcode);
      setName('');
      setOpen(false);
    } finally { setBusy(false); }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (open && results[highlighted]) {
      const r = results[highlighted];
      void add(r.name, r.barcode);
    } else {
      void add(name.trim());
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <form onSubmit={submit} className="relative">
      <div className="flex items-center gap-2 p-2 border-b border-border bg-surface">
        <button type="submit" disabled={busy || !name.trim()} className="btn-ghost p-2" aria-label="הוסף פריט">
          <Plus size={18} />
        </button>
        <input
          value={name}
          onChange={e => { setName(e.target.value); setOpen(true); setHighlighted(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          placeholder="הוסף פריט..."
          className="input flex-1"
          aria-autocomplete="list"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute right-0 left-0 top-full z-20 bg-surface border border-border rounded-b-md shadow-md max-h-80 overflow-y-auto"
            role="listbox">
          {results.map((r, i) => (
            <li
              key={r.barcode}
              role="option"
              aria-selected={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => { e.preventDefault(); void add(r.name, r.barcode); }}
              className={`px-3 py-2 cursor-pointer text-sm ${i === highlighted ? 'bg-muted' : ''}`}
            >
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                {r.unit_qty != null && r.unit_measure ? `${r.unit_qty} ${r.unit_measure} · ` : ''}
                ₪{r.price.toFixed(2)}
                {r.manufacturer ? ` · ${r.manufacturer}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm run test:run -- AddItemInput
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/AddItemInput.tsx src/test/components/AddItemInput.test.tsx
git commit -m "feat(ui): AddItemInput becomes a product autocomplete combobox"
```

---

### Task D4: Wire barcode through useListItems.addItem

**Files:**
- Modify: `src/hooks/useListItems.ts`

- [ ] **Step 1: Update addItem signature**

In `src/hooks/useListItems.ts`, replace the existing `addItem` function with:

```typescript
  async function addItem(name: string, barcode?: string, qty = 1, unit: string | null = null) {
    if (!listId) return;
    const { data } = await db.rpc('add_item', {
      p_list_id: listId,
      p_name: name,
      p_qty: qty,
      p_unit: unit,
      p_barcode: barcode ?? null,
    });
    await refresh();
    // RPC returns table(item_id uuid, barcode_applied boolean) — supabase-js
    // surfaces it as data: [{ item_id, barcode_applied }]
    const applied = Array.isArray(data) ? data[0]?.barcode_applied ?? false : false;
    return { appliedBarcode: barcode != null && applied };
  }
```

- [ ] **Step 2: Update callers**

Search for `addItem(` and `add(` callers; in `ActiveList.tsx` find the prop passed to `AddItemInput` and adapt:

```bash
grep -rn "addItem\|useListItems" src/components src/hooks
```

Update `src/components/ActiveList.tsx` (the call to `AddItemInput`) to pass through both args. Locate the existing `onAdd` prop wiring and change it to:

```typescript
        onAdd={async (name, barcode) => {
          const result = await addItem(name, barcode);
          if (barcode && result && !result.appliedBarcode) {
            toast('המוצר נוסף ללא מחיר');
          }
        }}
```

The `toast` import comes from `sonner` (already in the project per package.json). If `ActiveList.tsx` doesn't import it yet, add at the top:

```typescript
import { toast } from 'sonner';
```

- [ ] **Step 3: Update existing useListItems test if it exercises addItem signature**

```bash
npm run test:run -- useListItems
```
If the test fails because of the new signature, update the call sites in the test to match (positional → `addItem('x')` still works; `addItem('x', 'qty=2')` callers must update to `addItem('x', undefined, 2)`).

Expected: tests pass after fixes.

- [ ] **Step 4: Type-check + full test run**

```bash
npm run build && npm run test:run
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useListItems.ts src/components/ActiveList.tsx src/test/hooks/useListItems.test.ts
git commit -m "feat(items): wire barcode + barcode_applied through addItem flow"
```

---

### Task D5: Cart-total footer (TDD)

**Files:**
- Create: `src/test/components/CartTotalFooter.test.tsx`
- Create: `src/components/CartTotalFooter.tsx`
- Modify: `src/components/ActiveList.tsx`

- [ ] **Step 1: Write the failing tests**

Write to `src/test/components/CartTotalFooter.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartTotalFooter } from '../../components/CartTotalFooter';
import type { ListItem } from '../../lib/supabase';

function item(over: Partial<ListItem> = {}): ListItem {
  return {
    id: 'x', list_id: 'l', name: 'x', qty: 1, unit: null, notes: null,
    estimated_price: null, is_in_cart: false, sort_order: 0,
    created_by: null, last_purchased_at: null, barcode: null,
    created_at: '', updated_at: '',
    ...over,
  };
}

describe('CartTotalFooter', () => {
  it('renders nothing when list is empty', () => {
    const { container } = render(<CartTotalFooter items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no item has a price', () => {
    const { container } = render(<CartTotalFooter items={[item({ name: 'a' }), item({ name: 'b' })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sums price × qty over not-in-cart items', () => {
    render(<CartTotalFooter items={[
      item({ id: '1', estimated_price: 6.9, qty: 2 }),                          // 13.80
      item({ id: '2', estimated_price: 10.5, qty: 1 }),                         // 10.50
      item({ id: '3', estimated_price: 99,   qty: 1, is_in_cart: true }),       // excluded
    ]} />);
    expect(screen.getByText(/₪24\.30/)).toBeInTheDocument();
  });

  it('shows the ⓘ marker when some items lack a price', () => {
    render(<CartTotalFooter items={[
      item({ id: '1', estimated_price: 6.9, qty: 1 }),
      item({ id: '2', estimated_price: null, qty: 1 }),
    ]} />);
    expect(screen.getByLabelText(/פריטים ללא מחיר/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test:run -- CartTotalFooter
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CartTotalFooter**

Write to `src/components/CartTotalFooter.tsx`:

```typescript
import { Info } from 'lucide-react';
import type { ListItem } from '../lib/supabase';

interface Props { items: ListItem[]; }

export function CartTotalFooter({ items }: Props) {
  if (items.length === 0) return null;

  const eligible = items.filter(i => !i.is_in_cart);
  const priced   = eligible.filter(i => i.estimated_price != null);
  if (priced.length === 0) return null;

  const total = priced.reduce((acc, i) => acc + (i.estimated_price ?? 0) * i.qty, 0);
  const missing = eligible.length - priced.length;

  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 px-3 py-2 bg-surface border-t border-border text-sm">
      <span className="font-medium">סה״כ משוער: ₪{total.toFixed(2)}</span>
      {missing > 0 && (
        <span aria-label={`${missing} פריטים ללא מחיר`} title={`${missing} פריטים ללא מחיר`} className="text-muted-foreground">
          <Info size={14} />
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm run test:run -- CartTotalFooter
```
Expected: 4 tests pass.

- [ ] **Step 5: Wire CartTotalFooter into ActiveList**

In `src/components/ActiveList.tsx`, import the component and render it directly below the items list:

```typescript
import { CartTotalFooter } from './CartTotalFooter';
```

Find the JSX that renders the list of `ItemRow`s and append `<CartTotalFooter items={items} />` right after it (inside the same scrollable container so it sticks to the bottom of the list area).

- [ ] **Step 6: Type-check**

```bash
npm run build
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/CartTotalFooter.tsx src/test/components/CartTotalFooter.test.tsx src/components/ActiveList.tsx
git commit -m "feat(ui): cart-total footer with missing-price indicator"
```

---

## Phase E — Smoke test and finalize

### Task E1: Live smoke test in the app

**Files:** none (manual)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Sign in and verify autocomplete**

1. Open the app, sign in with Google.
2. Open any list.
3. Click the add-item input and type `חלב`. Within ~500ms a dropdown of ≥3 results should appear, each showing name · size · price.
4. Select one with a click. Verify the row appears with the catalog price.

- [ ] **Step 3: Verify cart total**

1. Add a 2nd item from the autocomplete.
2. Verify the footer shows `סה״כ משוער: ₪<sum of the two prices>`.
3. Add a free-text item (e.g., `פטרוזיליה ביתי`). Verify it appears without a price and the footer now shows an ⓘ icon (hover → tooltip "1 פריטים ללא מחיר").
4. Tick the checkbox on one of the priced items. Verify the footer total drops by that item's price.

- [ ] **Step 4: Verify Hebrew search ranking**

1. Type `חלב תנו` — Tnuva milk products should be at the top.
2. Type `אורז` — rice products should appear; not coffee or unrelated items.
3. Type `א` (single char) — dropdown stays empty.

- [ ] **Step 5: Verify the unknown-barcode UX path**

This requires triggering the race. Easiest way: in the SQL editor, run
```sql
delete from shopping.product_prices
  where barcode = (select barcode from shopping.search_products('חלב') limit 1);
```
Then in the UI: type `חלב`, the deleted item probably no longer shows; pick a different one. If you can reproduce a stale dropdown selection, expect the toast "המוצר נוסף ללא מחיר".

- [ ] **Step 6: Stop dev server**

Ctrl+C.

---

### Task E2: Version bump, HANDOFF update, final commit

**Files:**
- Modify: `package.json`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Bump version**

In `package.json` change `"version": "0.11.3"` → `"version": "0.12.0"`.

- [ ] **Step 2: Update HANDOFF.md**

Edit `HANDOFF.md`:
- In the header: change `Current state: v0.10.2` → `Current state: v0.12.0`. Update the date to today's date.
- In "Working end-to-end" section, add:
  - `Product autocomplete on add-item (Rami Levy catalog, ~30K products, refreshed daily via Edge Function + pg_cron)`
  - `Cart-total footer showing sum of estimated prices`
- In "Phase-2 backlog", remove `Auto-fetching prices via MCP` (now done), or convert it to `Cross-chain comparison (add Shufersal, Yochananof…)` as the natural next step.

- [ ] **Step 3: Commit and verify clean tree**

```bash
git add package.json HANDOFF.md
git commit -m "chore: bump to v0.12.0 — product catalog feature shipped"
git status
```
Expected: working tree clean.

- [ ] **Step 4: Final lint + build + tests**

```bash
npm run lint && npm run build && npm run test:run
```
Expected: all PASS.

---

## Self-review notes

- All 5 new tables, 2 new RPCs, 1 amended RPC, 1 new column, RLS policies, pg_cron schedule, Edge Function, frontend changes, and tests are covered.
- The Edge Function fetch URL pattern (`prices.rami-levy.co.il/` index → grep for `PriceFull*.gz`) is best-guess and may need adjustment when first deployed (see Task B2 Step 2 note); this is a known place to iterate, not a placeholder.
- The `app.service_role_key` uses a Postgres GUC (`current_setting`) instead of Supabase Vault to avoid version-specific Vault API differences; this is documented in Task A2 Step 7.
- Function signatures used consistently throughout: `search_products(text, text, int)`, `add_item(uuid, text, numeric, text, text)`, `refresh_products_now(text)`, `addItem(name, barcode?, qty?, unit?)`.
