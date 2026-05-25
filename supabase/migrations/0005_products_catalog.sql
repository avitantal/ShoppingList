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

-- =====================================================================
-- RPC: add_item (extended) — accepts optional p_barcode and returns
-- both the new row's id and a barcode_applied flag.
-- Preserves the prior behaviors: p_notes parameter and the
-- is_list_member() guard (add_item is SECURITY DEFINER so it bypasses
-- the list_items RLS policies; the explicit check is the gate).
-- Drop the prior signature to allow changing the return type.
-- =====================================================================
drop function if exists shopping.add_item(uuid, text, numeric, text, text);

create or replace function shopping.add_item(
  p_list_id uuid,
  p_name    text,
  p_qty     numeric default null,
  p_unit    text    default null,
  p_notes   text    default null,
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
  if not shopping.is_list_member(p_list_id) then raise exception 'not a member of list'; end if;

  if p_barcode is not null then
    select pp.price, p.unit_qty, p.unit_measure
      into v_price, v_unit_qty, v_unit
      from shopping.products p
      join shopping.product_prices pp on pp.barcode = p.barcode
      where p.barcode = p_barcode and pp.chain_code = 'rami-levy';
    v_applied := found;
  end if;

  insert into shopping.list_items
    (list_id, name, qty, unit, notes, estimated_price, barcode, created_by)
  values
    (p_list_id, p_name,
     coalesce(p_qty, v_unit_qty, 1),
     coalesce(p_unit, v_unit),
     p_notes,
     v_price,
     case when v_applied then p_barcode else null end,
     v_uid)
  returning id into v_id;

  return query select v_id, v_applied;
end $$;

grant execute on function shopping.add_item(uuid, text, numeric, text, text, text) to authenticated;

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
    values (p_chain_code, 'manual:' || auth.uid()::text)
    returning id into v_log_id;

  -- NOTE: app.service_role_key is set as a database-wide GUC (see Task C1).
  -- Custom GUCs in Postgres have no ACL — any authenticated session can read
  -- this value via SHOW or current_setting(). The trust model here assumes
  -- all `authenticated` users are also app owners; revisit before opening
  -- the app to untrusted users. Alternative: migrate to Supabase Vault and
  -- read via vault.decrypted_secrets in a SECURITY DEFINER helper.
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
