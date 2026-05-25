-- =====================================================================
-- 0007 — search_products also returns the chain identity so the
-- autocomplete row can render a chain badge / logo. Prepares the UI
-- for the next chain we onboard; with only Shufersal in the catalog
-- today, every row will show the Shufersal badge.
-- =====================================================================

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
  chain_display_name  text
)
language sql stable security invoker
set search_path = shopping, public, extensions
as $$
  with q as (select trim(p_query) as s)
  select p.barcode, p.name, p.unit_qty, p.unit_measure, p.manufacturer,
         pp.price, c.code as chain_code, c.display_name as chain_display_name
  from shopping.products p
  join shopping.product_prices pp on pp.barcode = p.barcode
  join shopping.chains         c  on c.code = pp.chain_code
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
