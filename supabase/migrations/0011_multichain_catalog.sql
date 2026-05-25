-- =====================================================================
-- 0011 — Multi-chain catalog support.
--   (a) Seed the rami_levy chain row. (Data populated by GitHub
--       Actions ingestion job — Rami Levy publishes via FTP, which
--       Supabase Edge Functions can't reach.)
--   (b) search_products: accept p_chain_codes text[] (null = all chains)
--       so the client can let the user toggle individual chains in/out
--       of the result set.
--   (c) Tie-break by ascending price so the cheapest source of a given
--       barcode surfaces first within the same relevance bucket.
-- =====================================================================

insert into shopping.chains (code, display_name)
  values ('rami_levy', 'רמי לוי')
  on conflict (code) do nothing;

-- Replace the single-chain RPC with a multi-chain version. Drop the old
-- signature first to allow changing the second-arg type from text to text[].
drop function if exists shopping.search_products(text, text, int);

create or replace function shopping.search_products(
  p_query        text,
  p_chain_codes  text[] default null,
  p_limit        int    default 16
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
    and (p_chain_codes is null or pp.chain_code = any(p_chain_codes))
    and p.name ilike '%' || q.s || '%'
  order by
    (pur.barcode is not null) desc,
    case when p.name ilike q.s || '%' then 0 else 1 end,
    similarity(p.name, q.s) desc,
    pp.price asc,
    p.name asc
  limit greatest(least(p_limit, 50), 1);
$$;

grant execute on function shopping.search_products(text, text[], int) to authenticated;
