-- =====================================================================
-- 0003 — Consolidate ShoppingList into PMW Supabase project under
-- a dedicated "shopping" schema. Re-creates everything from 0001 + 0002
-- but namespaced; deliberately omits the handle_new_user auth trigger
-- so PMW user signups don't get phantom shopping lists. The app code
-- ensures a default list exists on first ShoppingList load instead.
-- Apply to: xgihixrhosbxyloeoxnv (PMW project, account A).
-- =====================================================================

create schema if not exists shopping;
create extension if not exists citext;
create extension if not exists pgcrypto;

-- Utility (placed in shopping to avoid colliding with any PMW set_updated_at)
create or replace function shopping.set_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Enums
do $$ begin
  create type shopping.member_role as enum ('owner', 'editor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shopping.purchase_source as enum ('manual', 'auto_inventory');
exception when duplicate_object then null; end $$;

-- Tables
create table if not exists shopping.shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists shopping_lists_one_default_per_owner
  on shopping.shopping_lists(owner_id) where is_default;
create index if not exists shopping_lists_active_owner_idx
  on shopping.shopping_lists(owner_id) where archived_at is null;
drop trigger if exists trg_shopping_lists_updated on shopping.shopping_lists;
create trigger trg_shopping_lists_updated before update on shopping.shopping_lists
  for each row execute function shopping.set_updated_at();

create table if not exists shopping.list_members (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references shopping.shopping_lists(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  invited_email citext not null,
  role          shopping.member_role not null default 'editor',
  invited_by    uuid not null references auth.users(id) on delete cascade,
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  unique (list_id, invited_email)
);
create index if not exists list_members_user_idx  on shopping.list_members(user_id);
create index if not exists list_members_email_idx on shopping.list_members(invited_email);

create table if not exists shopping.list_items (
  id                 uuid primary key default gen_random_uuid(),
  list_id            uuid not null references shopping.shopping_lists(id) on delete cascade,
  name               text not null,
  qty                numeric not null default 1 check (qty > 0),
  unit               text,
  notes              text,
  estimated_price    numeric(10,2) check (estimated_price is null or estimated_price >= 0),
  is_in_cart         boolean not null default false,
  sort_order         integer not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  last_purchased_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists list_items_list_sort_idx on shopping.list_items(list_id, sort_order);
drop trigger if exists trg_list_items_updated on shopping.list_items;
create trigger trg_list_items_updated before update on shopping.list_items
  for each row execute function shopping.set_updated_at();

create table if not exists shopping.purchase_events (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references shopping.shopping_lists(id) on delete cascade,
  purchased_by  uuid not null references auth.users(id) on delete cascade,
  purchased_at  timestamptz not null default now(),
  store_chain   text,
  store_branch  text,
  total_price   numeric(10,2) check (total_price is null or total_price >= 0),
  source        shopping.purchase_source not null default 'manual',
  notes         text
);
create index if not exists purchase_events_list_time_idx
  on shopping.purchase_events(list_id, purchased_at desc);

create table if not exists shopping.purchase_event_items (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references shopping.purchase_events(id) on delete cascade,
  list_item_id  uuid references shopping.list_items(id) on delete set null,
  name_snapshot text not null,
  qty           numeric not null check (qty > 0),
  unit_price    numeric(10,2) check (unit_price is null or unit_price >= 0),
  line_total    numeric(10,2) check (line_total is null or line_total >= 0)
);
create index if not exists purchase_event_items_event_idx on shopping.purchase_event_items(event_id);

-- Views
create or replace view shopping.v_list_participants as
  select l.id  as list_id,
         l.owner_id as user_id,
         (select email from auth.users where id = l.owner_id) as email,
         'owner'::shopping.member_role as role,
         l.created_at as joined_at
    from shopping.shopping_lists l
  union all
  select m.list_id, m.user_id, m.invited_email::text as email, m.role, m.joined_at
    from shopping.list_members m;

create or replace view shopping.v_monthly_purchase_summary as
  select l.owner_id, e.list_id,
         to_char(e.purchased_at, 'YYYY-MM') as year_month,
         count(*) as event_count,
         coalesce(sum(e.total_price), 0) as total_spent
    from shopping.purchase_events e
    join shopping.shopping_lists l on l.id = e.list_id
   group by l.owner_id, e.list_id, year_month;

create or replace view shopping.v_item_frequency as
  select l.owner_id,
         lower(pei.name_snapshot) as item_name,
         count(*) as purchases_90d,
         min(e.purchased_at) as first_seen,
         max(e.purchased_at) as last_seen
    from shopping.purchase_event_items pei
    join shopping.purchase_events e on e.id = pei.event_id
    join shopping.shopping_lists  l on l.id = e.list_id
   where e.purchased_at >= now() - interval '90 days'
   group by l.owner_id, lower(pei.name_snapshot);

-- Helper + RLS
create or replace function shopping.is_list_member(p_list_id uuid) returns boolean
  language sql stable security definer set search_path = shopping, public, auth as $$
  select exists (
    select 1 from shopping.shopping_lists where id = p_list_id and owner_id = auth.uid()
    union all
    select 1 from shopping.list_members  where list_id = p_list_id and user_id = auth.uid()
  );
$$;

alter table shopping.shopping_lists       enable row level security;
alter table shopping.list_members         enable row level security;
alter table shopping.list_items           enable row level security;
alter table shopping.purchase_events      enable row level security;
alter table shopping.purchase_event_items enable row level security;

-- shopping_lists policies
drop policy if exists sl_select on shopping.shopping_lists;
create policy sl_select on shopping.shopping_lists for select
  using ( shopping.is_list_member(id) );
drop policy if exists sl_insert on shopping.shopping_lists;
create policy sl_insert on shopping.shopping_lists for insert
  with check ( owner_id = auth.uid() );
drop policy if exists sl_update on shopping.shopping_lists;
create policy sl_update on shopping.shopping_lists for update
  using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );
drop policy if exists sl_delete on shopping.shopping_lists;
create policy sl_delete on shopping.shopping_lists for delete
  using ( owner_id = auth.uid() );

-- list_members policies
drop policy if exists lm_select on shopping.list_members;
create policy lm_select on shopping.list_members for select
  using ( shopping.is_list_member(list_id) );
drop policy if exists lm_owner_write on shopping.list_members;
create policy lm_owner_write on shopping.list_members for all
  using       ( exists (select 1 from shopping.shopping_lists where id = list_id and owner_id = auth.uid()) )
  with check  ( exists (select 1 from shopping.shopping_lists where id = list_id and owner_id = auth.uid()) );

-- list_items policies
drop policy if exists li_select on shopping.list_items;
create policy li_select on shopping.list_items for select using ( shopping.is_list_member(list_id) );
drop policy if exists li_insert on shopping.list_items;
create policy li_insert on shopping.list_items for insert with check ( shopping.is_list_member(list_id) );
drop policy if exists li_update on shopping.list_items;
create policy li_update on shopping.list_items for update
  using ( shopping.is_list_member(list_id) ) with check ( shopping.is_list_member(list_id) );
drop policy if exists li_delete on shopping.list_items;
create policy li_delete on shopping.list_items for delete using ( shopping.is_list_member(list_id) );

-- purchase_events policies
drop policy if exists pe_select on shopping.purchase_events;
create policy pe_select on shopping.purchase_events for select using ( shopping.is_list_member(list_id) );
drop policy if exists pe_insert on shopping.purchase_events;
create policy pe_insert on shopping.purchase_events for insert with check ( shopping.is_list_member(list_id) );
drop policy if exists pe_update on shopping.purchase_events;
create policy pe_update on shopping.purchase_events for update
  using ( purchased_by = auth.uid() ) with check ( purchased_by = auth.uid() );
drop policy if exists pe_delete on shopping.purchase_events;
create policy pe_delete on shopping.purchase_events for delete using ( purchased_by = auth.uid() );

-- purchase_event_items policies
drop policy if exists pei_select on shopping.purchase_event_items;
create policy pei_select on shopping.purchase_event_items for select using (
  exists (select 1 from shopping.purchase_events e where e.id = event_id and shopping.is_list_member(e.list_id))
);
drop policy if exists pei_insert on shopping.purchase_event_items;
create policy pei_insert on shopping.purchase_event_items for insert with check (
  exists (select 1 from shopping.purchase_events e where e.id = event_id and shopping.is_list_member(e.list_id))
);
drop policy if exists pei_update on shopping.purchase_event_items;
create policy pei_update on shopping.purchase_event_items for update
  using       ( exists (select 1 from shopping.purchase_events e where e.id = event_id and e.purchased_by = auth.uid()) )
  with check  ( exists (select 1 from shopping.purchase_events e where e.id = event_id and e.purchased_by = auth.uid()) );
drop policy if exists pei_delete on shopping.purchase_event_items;
create policy pei_delete on shopping.purchase_event_items for delete using (
  exists (select 1 from shopping.purchase_events e where e.id = event_id and e.purchased_by = auth.uid())
);

-- =====================================================================
-- RPCs (all SECURITY DEFINER, as fixed in 0002)
-- =====================================================================

create or replace function shopping.create_list(p_name text, p_make_default boolean default false)
returns uuid language plpgsql security definer set search_path = shopping, public, auth as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_make_default then
    update shopping.shopping_lists set is_default = false where owner_id = v_uid and is_default;
  end if;
  insert into shopping.shopping_lists (owner_id, name, is_default)
    values (v_uid, p_name, p_make_default)
    returning id into v_id;
  return v_id;
end $$;

create or replace function shopping.archive_list(p_list_id uuid)
returns void language plpgsql security definer set search_path = shopping, public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update shopping.shopping_lists set archived_at = now()
   where id = p_list_id and owner_id = v_uid;
end $$;

create or replace function shopping.delete_list_permanently(p_list_id uuid)
returns void language plpgsql security definer set search_path = shopping, public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  delete from shopping.shopping_lists where id = p_list_id and owner_id = v_uid;
end $$;

create or replace function shopping.share_list(p_list_id uuid, p_email citext, p_role shopping.member_role default 'editor')
returns void language plpgsql security definer set search_path = shopping, public, auth as $$
declare v_uid uuid := auth.uid();
        v_owner uuid; v_owner_email citext; v_resolved_user uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from shopping.shopping_lists where id = p_list_id;
  if v_owner is null then raise exception 'list not found'; end if;
  if v_owner <> v_uid then raise exception 'only the owner can share'; end if;

  select email::citext into v_owner_email from auth.users where id = v_owner;
  if v_owner_email = p_email then return; end if;

  select id into v_resolved_user from auth.users where email::citext = p_email;

  insert into shopping.list_members (list_id, user_id, invited_email, role, invited_by, joined_at)
    values (p_list_id, v_resolved_user, p_email, p_role, v_uid,
            case when v_resolved_user is not null then now() else null end)
  on conflict (list_id, invited_email)
    do update set role = excluded.role,
                  user_id  = coalesce(shopping.list_members.user_id, excluded.user_id),
                  joined_at = coalesce(shopping.list_members.joined_at, excluded.joined_at);
end $$;

create or replace function shopping.unshare_list(p_list_id uuid, p_email citext)
returns void language plpgsql security definer set search_path = shopping, public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from shopping.shopping_lists where id = p_list_id and owner_id = v_uid) then
    raise exception 'only the owner can unshare';
  end if;
  delete from shopping.list_members where list_id = p_list_id and invited_email = p_email;
end $$;

create or replace function shopping.add_item(
  p_list_id uuid, p_name text, p_qty numeric default 1,
  p_unit text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = shopping, public, auth as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not shopping.is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  insert into shopping.list_items (list_id, name, qty, unit, notes, created_by)
    values (p_list_id, p_name, p_qty, p_unit, p_notes, v_uid)
    returning id into v_id;
  return v_id;
end $$;

create or replace function shopping.complete_checkout(
  p_list_id uuid, p_store_chain text, p_store_branch text, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = shopping, public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid; v_item jsonb; v_list_item_id uuid;
  v_qty numeric; v_unit_price numeric; v_line_total numeric;
  v_total numeric := 0; v_purchased_item_ids uuid[] := '{}';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not shopping.is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty JSON array';
  end if;

  insert into shopping.purchase_events (list_id, purchased_by, store_chain, store_branch)
    values (p_list_id, v_uid, nullif(btrim(p_store_chain), ''), nullif(btrim(p_store_branch), ''))
    returning id into v_event_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_list_item_id := nullif(v_item->>'list_item_id', '')::uuid;
    v_qty          := (v_item->>'qty')::numeric;
    v_unit_price   := nullif(v_item->>'unit_price', '')::numeric;

    if v_qty is null or v_qty <= 0 then raise exception 'qty must be > 0 for item %', v_item; end if;
    if v_unit_price is not null and v_unit_price < 0 then raise exception 'unit_price must be >= 0 for item %', v_item; end if;

    if v_list_item_id is not null then
      if not exists (select 1 from shopping.list_items where id = v_list_item_id and list_id = p_list_id) then
        raise exception 'list_item_id % does not belong to list %', v_list_item_id, p_list_id;
      end if;
      v_purchased_item_ids := array_append(v_purchased_item_ids, v_list_item_id);
    end if;

    v_line_total := v_qty * coalesce(v_unit_price, 0);
    v_total := v_total + v_line_total;

    insert into shopping.purchase_event_items (event_id, list_item_id, name_snapshot, qty, unit_price, line_total)
      values (v_event_id, v_list_item_id, v_item->>'name', v_qty, v_unit_price,
              case when v_unit_price is null then null else v_line_total end);
  end loop;

  update shopping.purchase_events set total_price = v_total where id = v_event_id;

  if array_length(v_purchased_item_ids, 1) > 0 then
    update shopping.list_items
       set is_in_cart = false, last_purchased_at = now()
     where id = any(v_purchased_item_ids);
  end if;

  return v_event_id;
end $$;

-- Grant usage to PostgREST roles (authenticated/anon). Supabase normally
-- handles this for the exposed schema, but we make it explicit since
-- "shopping" is not the default.
grant usage on schema shopping to anon, authenticated;
grant select, insert, update, delete on all tables in schema shopping to authenticated;
grant select on shopping.v_list_participants, shopping.v_monthly_purchase_summary, shopping.v_item_frequency to authenticated;
grant execute on all functions in schema shopping to authenticated;
alter default privileges in schema shopping
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema shopping
  grant execute on functions to authenticated;
