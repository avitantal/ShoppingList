-- =====================================================================
-- 0006 — Swap the seeded chain from Rami Levy to Shufersal.
-- Rationale: Rami Levy publishes the Food Transparency feed via FTP
-- only, which Deno Edge Functions can't reach. Shufersal publishes
-- via HTTPS and is the larger chain anyway. The PoC's user-visible
-- behavior is unchanged — autocomplete + cart total still work.
-- See: docs/superpowers/specs/2026-05-25-product-catalog-design.md
-- =====================================================================

insert into shopping.chains (code, display_name)
  values ('shufersal', 'שופרסל')
  on conflict (code) do nothing;

-- Drop the old rami-levy seed row (no products were ever loaded for it).
delete from shopping.product_prices where chain_code = 'rami-levy';
delete from shopping.chains where code = 'rami-levy';

-- Re-create shopping.add_item with the chain reference pointed at
-- 'shufersal' instead of 'rami-levy'. Body is identical to migration
-- 0005 otherwise.
drop function if exists shopping.add_item(uuid, text, numeric, text, text, text);

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
      where p.barcode = p_barcode and pp.chain_code = 'shufersal';
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

-- Change search_products' default chain too.
create or replace function shopping.search_products(
  p_query      text,
  p_chain_code text default 'shufersal',
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

-- The refresh_products_now RPC and refresh_log table are kept in place
-- as no-ops for now — they cost nothing and may be reused if/when a
-- daily-refresh path is implemented via GitHub Actions (phase 3).
