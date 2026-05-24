-- =====================================================================
-- 0002 — Switch user-facing RPCs to SECURITY DEFINER.
-- Reason: SECURITY INVOKER + RLS on shopping_lists rejected the INSERT
--   even when owner_id = auth.uid() (observed in prod 2026-05-24).
-- Safe because each function explicitly anchors writes to auth.uid()
--   and/or checks is_list_member() before touching data.
-- =====================================================================

create or replace function create_list(p_name text, p_make_default boolean default false)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_make_default then
    update shopping_lists set is_default = false where owner_id = v_uid and is_default;
  end if;
  insert into shopping_lists (owner_id, name, is_default)
    values (v_uid, p_name, p_make_default)
    returning id into v_id;
  return v_id;
end $$;

create or replace function archive_list(p_list_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update shopping_lists set archived_at = now()
   where id = p_list_id and owner_id = v_uid;
end $$;

create or replace function delete_list_permanently(p_list_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  delete from shopping_lists where id = p_list_id and owner_id = v_uid;
end $$;

create or replace function share_list(p_list_id uuid, p_email citext, p_role member_role default 'editor')
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
        v_owner uuid; v_owner_email citext; v_resolved_user uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from shopping_lists where id = p_list_id;
  if v_owner is null then raise exception 'list not found'; end if;
  if v_owner <> v_uid then raise exception 'only the owner can share'; end if;

  select email::citext into v_owner_email from auth.users where id = v_owner;
  if v_owner_email = p_email then return; end if;

  select id into v_resolved_user from auth.users where email::citext = p_email;

  insert into list_members (list_id, user_id, invited_email, role, invited_by, joined_at)
    values (p_list_id, v_resolved_user, p_email, p_role, v_uid,
            case when v_resolved_user is not null then now() else null end)
  on conflict (list_id, invited_email)
    do update set role = excluded.role,
                  user_id  = coalesce(list_members.user_id, excluded.user_id),
                  joined_at = coalesce(list_members.joined_at, excluded.joined_at);
end $$;

create or replace function unshare_list(p_list_id uuid, p_email citext)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from shopping_lists where id = p_list_id and owner_id = v_uid) then
    raise exception 'only the owner can unshare';
  end if;
  delete from list_members where list_id = p_list_id and invited_email = p_email;
end $$;

create or replace function add_item(
  p_list_id uuid, p_name text, p_qty numeric default 1,
  p_unit text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  insert into list_items (list_id, name, qty, unit, notes, created_by)
    values (p_list_id, p_name, p_qty, p_unit, p_notes, v_uid)
    returning id into v_id;
  return v_id;
end $$;

create or replace function complete_checkout(
  p_list_id uuid, p_store_chain text, p_store_branch text, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid; v_item jsonb; v_list_item_id uuid;
  v_qty numeric; v_unit_price numeric; v_line_total numeric;
  v_total numeric := 0; v_purchased_item_ids uuid[] := '{}';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty JSON array';
  end if;

  insert into purchase_events (list_id, purchased_by, store_chain, store_branch)
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
