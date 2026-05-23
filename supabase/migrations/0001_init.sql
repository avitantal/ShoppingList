-- =====================================================================
-- Shopping List — initial schema (per spec 2026-05-23-shopping-list-design.md)
-- =====================================================================

-- 4.0 Prerequisites
create extension if not exists citext;
create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- 4.1 Enums
do $$ begin
  create type member_role as enum ('owner', 'editor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type purchase_source as enum ('manual', 'auto_inventory');
exception when duplicate_object then null; end $$;

-- 4.2 shopping_lists
create table if not exists shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists shopping_lists_one_default_per_owner
  on shopping_lists(owner_id) where is_default;
create index if not exists shopping_lists_active_owner_idx
  on shopping_lists(owner_id) where archived_at is null;
drop trigger if exists trg_shopping_lists_updated on shopping_lists;
create trigger trg_shopping_lists_updated before update on shopping_lists
  for each row execute function set_updated_at();

comment on table  shopping_lists is 'A named shopping list. Owned by one user; optionally shared with others via list_members.';
comment on column shopping_lists.is_default  is 'Exactly one default list per owner (partial unique index).';
comment on column shopping_lists.archived_at is 'Soft-delete marker. UI Delete = set this. Permanent delete is a separate RPC.';

-- 4.3 list_members
create table if not exists list_members (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references shopping_lists(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  invited_email citext not null,
  role          member_role not null default 'editor',
  invited_by    uuid not null references auth.users(id) on delete cascade,
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  unique (list_id, invited_email)
);
create index if not exists list_members_user_idx  on list_members(user_id);
create index if not exists list_members_email_idx on list_members(invited_email);

comment on table  list_members is 'Sharing rows. Owner is NOT duplicated here — see is_list_member() and v_list_participants.';
comment on column list_members.user_id is 'NULL until the invited email signs in for the first time (handle_new_user resolves it).';

-- 4.4 list_items
create table if not exists list_items (
  id                 uuid primary key default gen_random_uuid(),
  list_id            uuid not null references shopping_lists(id) on delete cascade,
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
create index if not exists list_items_list_sort_idx on list_items(list_id, sort_order);
drop trigger if exists trg_list_items_updated on list_items;
create trigger trg_list_items_updated before update on list_items
  for each row execute function set_updated_at();

comment on table  list_items is 'Persistent template items per list. is_in_cart is the SHARED current-cart state for the list (not personal).';
comment on column list_items.qty                is 'Desired quantity (template). Actual purchased qty lives in purchase_event_items.qty.';
comment on column list_items.is_in_cart         is 'Shared cart state for co-editing — when set, the item is considered "in the cart now" by everyone.';
comment on column list_items.last_purchased_at  is 'Denormalized — set by complete_checkout for fast UI ("נקנה לפני 3 ימים").';

-- 4.5 purchase_events
create table if not exists purchase_events (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references shopping_lists(id) on delete cascade,
  purchased_by  uuid not null references auth.users(id) on delete cascade,
  purchased_at  timestamptz not null default now(),
  store_chain   text,
  store_branch  text,
  total_price   numeric(10,2) check (total_price is null or total_price >= 0),
  source        purchase_source not null default 'manual',
  notes         text
);
create index if not exists purchase_events_list_time_idx
  on purchase_events(list_id, purchased_at desc);

comment on table  purchase_events is 'One "checkout" event. total_price is computed and written by complete_checkout — never by the client.';

-- 4.6 purchase_event_items
create table if not exists purchase_event_items (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references purchase_events(id) on delete cascade,
  list_item_id  uuid references list_items(id) on delete set null,
  name_snapshot text not null,
  qty           numeric not null check (qty > 0),
  unit_price    numeric(10,2) check (unit_price is null or unit_price >= 0),
  line_total    numeric(10,2) check (line_total is null or line_total >= 0)
);
create index if not exists purchase_event_items_event_idx on purchase_event_items(event_id);

comment on table  purchase_event_items is 'Snapshot lines of a checkout. line_total is computed server-side by complete_checkout.';

-- 4.8 Views
create or replace view v_list_participants as
  select l.id  as list_id,
         l.owner_id as user_id,
         (select email from auth.users where id = l.owner_id) as email,
         'owner'::member_role as role,
         l.created_at as joined_at
    from shopping_lists l
  union all
  select m.list_id,
         m.user_id,
         m.invited_email::text as email,
         m.role,
         m.joined_at
    from list_members m;

comment on view v_list_participants is 'Unified view of list owners + shared members. Use this in UI/MCP queries about "who has access".';

create or replace view v_monthly_purchase_summary as
  select l.owner_id,
         e.list_id,
         to_char(e.purchased_at, 'YYYY-MM') as year_month,
         count(*)                          as event_count,
         coalesce(sum(e.total_price), 0)   as total_spent
    from purchase_events e
    join shopping_lists l on l.id = e.list_id
   group by l.owner_id, e.list_id, year_month;

comment on view v_monthly_purchase_summary is 'Monthly spend per (owner, list). For reporting + MCP-driven questions like "how much did I spend last month?".';

create or replace view v_item_frequency as
  select l.owner_id,
         lower(pei.name_snapshot) as item_name,
         count(*)                 as purchases_90d,
         min(e.purchased_at)      as first_seen,
         max(e.purchased_at)      as last_seen
    from purchase_event_items pei
    join purchase_events e on e.id = pei.event_id
    join shopping_lists  l on l.id = e.list_id
   where e.purchased_at >= now() - interval '90 days'
   group by l.owner_id, lower(pei.name_snapshot);

comment on view v_item_frequency is 'Per-user item buy frequency in last 90 days. Foundation for phase-2 auto-list generation.';

-- 5. is_list_member helper + RLS
create or replace function is_list_member(p_list_id uuid) returns boolean
  language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from shopping_lists where id = p_list_id and owner_id = auth.uid()
    union all
    select 1 from list_members  where list_id = p_list_id and user_id = auth.uid()
  );
$$;

alter table shopping_lists       enable row level security;
alter table list_members         enable row level security;
alter table list_items           enable row level security;
alter table purchase_events      enable row level security;
alter table purchase_event_items enable row level security;

-- shopping_lists policies
drop policy if exists sl_select on shopping_lists;
create policy sl_select on shopping_lists for select
  using ( is_list_member(id) );

drop policy if exists sl_insert on shopping_lists;
create policy sl_insert on shopping_lists for insert
  with check ( owner_id = auth.uid() );

drop policy if exists sl_update on shopping_lists;
create policy sl_update on shopping_lists for update
  using       ( owner_id = auth.uid() )
  with check  ( owner_id = auth.uid() );  -- owner_id is immutable

drop policy if exists sl_delete on shopping_lists;
create policy sl_delete on shopping_lists for delete
  using ( owner_id = auth.uid() );

-- list_members policies
drop policy if exists lm_select on list_members;
create policy lm_select on list_members for select
  using ( is_list_member(list_id) );

drop policy if exists lm_owner_write on list_members;
create policy lm_owner_write on list_members for all
  using       ( exists (select 1 from shopping_lists where id = list_id and owner_id = auth.uid()) )
  with check  ( exists (select 1 from shopping_lists where id = list_id and owner_id = auth.uid()) );

-- list_items policies
drop policy if exists li_select on list_items;
create policy li_select on list_items for select using ( is_list_member(list_id) );
drop policy if exists li_insert on list_items;
create policy li_insert on list_items for insert with check ( is_list_member(list_id) );
drop policy if exists li_update on list_items;
create policy li_update on list_items for update
  using ( is_list_member(list_id) ) with check ( is_list_member(list_id) );
drop policy if exists li_delete on list_items;
create policy li_delete on list_items for delete using ( is_list_member(list_id) );

-- purchase_events policies
drop policy if exists pe_select on purchase_events;
create policy pe_select on purchase_events for select using ( is_list_member(list_id) );
drop policy if exists pe_insert on purchase_events;
create policy pe_insert on purchase_events for insert with check ( is_list_member(list_id) );
drop policy if exists pe_update on purchase_events;
create policy pe_update on purchase_events for update
  using ( purchased_by = auth.uid() ) with check ( purchased_by = auth.uid() );
drop policy if exists pe_delete on purchase_events;
create policy pe_delete on purchase_events for delete using ( purchased_by = auth.uid() );

-- purchase_event_items — access through event
drop policy if exists pei_select on purchase_event_items;
create policy pei_select on purchase_event_items for select using (
  exists (select 1 from purchase_events e where e.id = event_id and is_list_member(e.list_id))
);
drop policy if exists pei_insert on purchase_event_items;
create policy pei_insert on purchase_event_items for insert with check (
  exists (select 1 from purchase_events e where e.id = event_id and is_list_member(e.list_id))
);
drop policy if exists pei_update on purchase_event_items;
create policy pei_update on purchase_event_items for update
  using       ( exists (select 1 from purchase_events e where e.id = event_id and e.purchased_by = auth.uid()) )
  with check  ( exists (select 1 from purchase_events e where e.id = event_id and e.purchased_by = auth.uid()) );
drop policy if exists pei_delete on purchase_event_items;
create policy pei_delete on purchase_event_items for delete using (
  exists (select 1 from purchase_events e where e.id = event_id and e.purchased_by = auth.uid())
);

-- 4.9 Bootstrap trigger
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public, auth as $$
begin
  insert into shopping_lists (owner_id, name, is_default)
    values (new.id, 'הרשימה שלי', true);
  update list_members
     set user_id = new.id, joined_at = now()
   where invited_email = new.email and user_id is null;
  return new;
end $$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function handle_new_user();

-- 6. RPCs
create or replace function create_list(p_name text, p_make_default boolean default false)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if p_make_default then
    update shopping_lists set is_default = false where owner_id = auth.uid() and is_default;
  end if;
  insert into shopping_lists (owner_id, name, is_default)
    values (auth.uid(), p_name, p_make_default)
    returning id into v_id;
  return v_id;
end $$;
comment on function create_list is 'Create a new shopping list owned by the caller. If p_make_default, makes it the user''s default (clearing the previous default first).';

create or replace function archive_list(p_list_id uuid)
returns void language sql security invoker set search_path = public as $$
  update shopping_lists set archived_at = now()
   where id = p_list_id and owner_id = auth.uid();
$$;
comment on function archive_list is 'Soft-delete a list (owner only). UI default for "Delete".';

create or replace function delete_list_permanently(p_list_id uuid)
returns void language sql security invoker set search_path = public as $$
  delete from shopping_lists where id = p_list_id and owner_id = auth.uid();
$$;
comment on function delete_list_permanently is 'Hard-delete a list incl. items + history (cascade). Owner only. Hidden behind a confirmation in UI.';

create or replace function share_list(p_list_id uuid, p_email citext, p_role member_role default 'editor')
returns void language plpgsql security invoker set search_path = public, auth as $$
declare v_owner uuid; v_owner_email citext; v_resolved_user uuid;
begin
  select owner_id into v_owner from shopping_lists where id = p_list_id;
  if v_owner is null then raise exception 'list not found'; end if;
  if v_owner <> auth.uid() then raise exception 'only the owner can share'; end if;

  select email::citext into v_owner_email from auth.users where id = v_owner;
  if v_owner_email = p_email then
    return; -- no-op success: owner inviting themselves
  end if;

  select id into v_resolved_user from auth.users where email::citext = p_email;

  insert into list_members (list_id, user_id, invited_email, role, invited_by, joined_at)
    values (p_list_id, v_resolved_user, p_email, p_role, auth.uid(),
            case when v_resolved_user is not null then now() else null end)
  on conflict (list_id, invited_email)
    do update set role = excluded.role,
                  user_id  = coalesce(list_members.user_id, excluded.user_id),
                  joined_at = coalesce(list_members.joined_at, excluded.joined_at);
end $$;
comment on function share_list is 'Owner-only. Shares the list with the given email (creates a pending invite if no such user yet). No-op success if the email is the owner''s own.';

create or replace function unshare_list(p_list_id uuid, p_email citext)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from shopping_lists where id = p_list_id and owner_id = auth.uid()) then
    raise exception 'only the owner can unshare';
  end if;
  delete from list_members where list_id = p_list_id and invited_email = p_email;
end $$;
comment on function unshare_list is 'Owner-only. Removes a member (or a pending invite) by email.';

create or replace function add_item(
  p_list_id uuid,
  p_name text,
  p_qty numeric default 1,
  p_unit text default null,
  p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  insert into list_items (list_id, name, qty, unit, notes, created_by)
    values (p_list_id, p_name, p_qty, p_unit, p_notes, auth.uid())
    returning id into v_id;
  return v_id;
end $$;
comment on function add_item is 'Convenience RPC for MCP. Adds an item to the given list with the caller as created_by.';

create or replace function complete_checkout(
  p_list_id      uuid,
  p_store_chain  text,
  p_store_branch text,
  p_items        jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_event_id uuid;
  v_item     jsonb;
  v_list_item_id uuid;
  v_qty      numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_total    numeric := 0;
  v_purchased_item_ids uuid[] := '{}';
begin
  if not is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty JSON array';
  end if;

  insert into purchase_events (list_id, purchased_by, store_chain, store_branch)
    values (p_list_id, auth.uid(), nullif(btrim(p_store_chain), ''), nullif(btrim(p_store_branch), ''))
    returning id into v_event_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_list_item_id := nullif(v_item->>'list_item_id', '')::uuid;
    v_qty          := (v_item->>'qty')::numeric;
    v_unit_price   := nullif(v_item->>'unit_price', '')::numeric;

    if v_qty is null or v_qty <= 0 then raise exception 'qty must be > 0 for item %', v_item; end if;
    if v_unit_price is not null and v_unit_price < 0 then raise exception 'unit_price must be >= 0 for item %', v_item; end if;

    if v_list_item_id is not null then
      if not exists (select 1 from list_items where id = v_list_item_id and list_id = p_list_id) then
        raise exception 'list_item_id % does not belong to list %', v_list_item_id, p_list_id;
      end if;
      v_purchased_item_ids := array_append(v_purchased_item_ids, v_list_item_id);
    end if;

    v_line_total := v_qty * coalesce(v_unit_price, 0);
    v_total := v_total + v_line_total;

    insert into purchase_event_items (event_id, list_item_id, name_snapshot, qty, unit_price, line_total)
      values (v_event_id, v_list_item_id, v_item->>'name', v_qty, v_unit_price,
              case when v_unit_price is null then null else v_line_total end);
  end loop;

  update purchase_events set total_price = v_total where id = v_event_id;

  if array_length(v_purchased_item_ids, 1) > 0 then
    update list_items
       set is_in_cart = false, last_purchased_at = now()
     where id = any(v_purchased_item_ids);
  end if;

  return v_event_id;
end $$;
comment on function complete_checkout is 'Atomic checkout. Input: jsonb array of {list_item_id?, name, qty, unit_price?}. Computes line_total and total_price server-side. Clears is_in_cart and stamps last_purchased_at on purchased templates. Returns the new event id.';
