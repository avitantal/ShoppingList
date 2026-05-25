-- =====================================================================
-- 0010 — Two UX-driven RPC changes:
--   (a) add_item: when a catalog product is selected, qty defaults to 1.
--       The catalog's package size (e.g. "700 גרם") is descriptive
--       metadata, not the buy quantity the user wants.
--   (b) search_products: rank barcodes the caller has previously
--       purchased above strangers, regardless of name-prefix match.
-- =====================================================================

-- ----- (a) add_item: qty defaults to 1, not catalog unit_qty ---------
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
  v_applied   boolean := false;
  v_id        uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not shopping.is_list_member(p_list_id) then raise exception 'not a member of list'; end if;

  if p_barcode is not null then
    select pp.price
      into v_price
      from shopping.products p
      join shopping.product_prices pp on pp.barcode = p.barcode
      where p.barcode = p_barcode and pp.chain_code = 'shufersal';
    v_applied := found;
  end if;

  insert into shopping.list_items
    (list_id, name, qty, unit, notes, estimated_price, barcode, created_by)
  values
    (p_list_id, p_name,
     coalesce(p_qty, 1),
     p_unit,
     p_notes,
     v_price,
     case when v_applied then p_barcode else null end,
     v_uid)
  returning id into v_id;

  return query select v_id, v_applied;
end $$;

grant execute on function shopping.add_item(uuid, text, numeric, text, text, text) to authenticated;

-- ----- (b) search_products: previously-purchased barcodes rank first --
drop function if exists shopping.search_products(text, text, int);

create or replace function shopping.search_products(
  p_query      text,
  p_chain_code text default 'shufersal',
  p_limit      int  default 8
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
  with q as (select trim(p_query) as s),
  purchased as (
    -- Barcodes the caller has bought before, across any list they're a
    -- member of. Uses list_items.barcode (set when an item was created
    -- from the catalog) joined to checkout snapshots.
    select distinct li.barcode
    from shopping.list_items li
    join shopping.purchase_event_items pei on pei.list_item_id = li.id
    join shopping.purchase_events       pe  on pe.id = pei.event_id
    where li.barcode is not null
      and shopping.is_list_member(pe.list_id)
  )
  select p.barcode, p.name, p.unit_qty, p.unit_measure, p.manufacturer,
         pp.price, c.code as chain_code, c.display_name as chain_display_name,
         (pur.barcode is not null) as previously_bought
  from shopping.products p
  join shopping.product_prices pp on pp.barcode = p.barcode
  join shopping.chains         c  on c.code = pp.chain_code
  left join purchased pur on pur.barcode = p.barcode
  cross join q
  where length(q.s) >= 2
    and pp.chain_code = p_chain_code
    and p.name ilike '%' || q.s || '%'
  order by
    (pur.barcode is not null) desc,
    case when p.name ilike q.s || '%' then 0 else 1 end,
    similarity(p.name, q.s) desc,
    p.name asc
  limit greatest(least(p_limit, 50), 1);
$$;

grant execute on function shopping.search_products(text, text, int) to authenticated;
