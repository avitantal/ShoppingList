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
