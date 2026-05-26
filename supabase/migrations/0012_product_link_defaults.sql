-- =====================================================================
-- 0012 — Per-user product-link defaults.
--
-- Stores the user's preferred catalog product for a manually typed item
-- name. This replaces the previous localStorage-only behavior so the
-- default follows the user across devices and browsers.
-- =====================================================================

create table if not exists shopping.product_link_defaults (
  user_id             uuid not null references auth.users(id) on delete cascade,
  item_name_key       text not null,
  item_name_snapshot  text not null,
  barcode             text not null,
  chain_code          text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (user_id, item_name_key),
  foreign key (barcode, chain_code)
    references shopping.product_prices(barcode, chain_code)
    on delete cascade
);

create index if not exists product_link_defaults_user_updated_idx
  on shopping.product_link_defaults(user_id, updated_at desc);

drop trigger if exists trg_product_link_defaults_updated on shopping.product_link_defaults;
create trigger trg_product_link_defaults_updated before update on shopping.product_link_defaults
  for each row execute function shopping.set_updated_at();

alter table shopping.product_link_defaults enable row level security;

drop policy if exists product_link_defaults_select on shopping.product_link_defaults;
create policy product_link_defaults_select on shopping.product_link_defaults
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists product_link_defaults_insert on shopping.product_link_defaults;
create policy product_link_defaults_insert on shopping.product_link_defaults
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists product_link_defaults_update on shopping.product_link_defaults;
create policy product_link_defaults_update on shopping.product_link_defaults
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists product_link_defaults_delete on shopping.product_link_defaults;
create policy product_link_defaults_delete on shopping.product_link_defaults
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on shopping.product_link_defaults to authenticated;

create or replace function shopping.normalize_product_link_item_name(p_name text)
returns text
language sql immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'));
$$;

create or replace function shopping.save_product_link_default(
  p_item_name  text,
  p_barcode    text,
  p_chain_code text
) returns void
language plpgsql security invoker
set search_path = shopping, public, auth, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := shopping.normalize_product_link_item_name(p_item_name);
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_key = '' then raise exception 'item name is required'; end if;

  if not exists (
    select 1
    from shopping.product_prices pp
    where pp.barcode = p_barcode
      and pp.chain_code = p_chain_code
  ) then
    raise exception 'product price not found for barcode %, chain %', p_barcode, p_chain_code;
  end if;

  insert into shopping.product_link_defaults
    (user_id, item_name_key, item_name_snapshot, barcode, chain_code)
  values
    (v_uid, v_key, btrim(p_item_name), p_barcode, p_chain_code)
  on conflict (user_id, item_name_key) do update set
    item_name_snapshot = excluded.item_name_snapshot,
    barcode            = excluded.barcode,
    chain_code         = excluded.chain_code;
end $$;

create or replace function shopping.get_product_link_default(
  p_item_name text
) returns table(
  barcode             text,
  name                text,
  unit_qty            numeric,
  unit_measure        text,
  manufacturer        text,
  price               numeric,
  chain_code          text,
  chain_display_name  text,
  previously_bought   boolean
)
language sql stable security invoker
set search_path = shopping, public, auth, extensions
as $$
  select p.barcode, p.name, p.unit_qty, p.unit_measure, p.manufacturer,
         pp.price, c.code as chain_code, c.display_name as chain_display_name,
         false as previously_bought
  from shopping.product_link_defaults d
  join shopping.products p
    on p.barcode = d.barcode
  join shopping.product_prices pp
    on pp.barcode = d.barcode
   and pp.chain_code = d.chain_code
  join shopping.chains c
    on c.code = d.chain_code
  where d.user_id = auth.uid()
    and d.item_name_key = shopping.normalize_product_link_item_name(p_item_name)
  limit 1;
$$;

grant execute on function shopping.normalize_product_link_item_name(text) to authenticated;
grant execute on function shopping.save_product_link_default(text, text, text) to authenticated;
grant execute on function shopping.get_product_link_default(text) to authenticated;
