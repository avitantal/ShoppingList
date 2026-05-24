-- =====================================================================
-- 0004 — Idempotent default-list bootstrap.
-- Bug observed 2026-05-24: on first sign-in 3 concurrent refresh()
-- calls (mount + onAuthStateChange + realtime init) each saw "no
-- lists" and each called create_list, creating 3 duplicate
-- "הרשימה שלי" rows within 80 ms.
-- Fix: per-user advisory lock serializes the bootstrap so only the
-- first concurrent caller creates a list; the others find and return
-- the just-created one.
-- =====================================================================

create or replace function shopping.ensure_default_list()
returns uuid
language plpgsql security definer set search_path = shopping, public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Serialize concurrent calls per user.
  perform pg_advisory_xact_lock(hashtext('shopping.ensure_default_list:' || v_uid::text));

  -- After lock acquired: check again (another caller may have just created one).
  select id into v_id
    from shopping.shopping_lists
   where owner_id = v_uid and archived_at is null
   order by is_default desc, created_at asc
   limit 1;
  if v_id is not null then return v_id; end if;

  -- None exists — create the default list.
  insert into shopping.shopping_lists (owner_id, name, is_default)
    values (v_uid, 'הרשימה שלי', true)
    returning id into v_id;
  return v_id;
end $$;

grant execute on function shopping.ensure_default_list() to authenticated;

-- ---------------------------------------------------------------------
-- One-shot cleanup of duplicate empty "הרשימה שלי" rows already created
-- for the affected user. Keep the row with items and/or the default;
-- delete the empty non-default duplicates.
-- ---------------------------------------------------------------------
with ranked as (
  select l.id, l.owner_id,
         (select count(*) from shopping.list_items i where i.list_id = l.id) as item_count,
         l.is_default,
         row_number() over (partition by l.owner_id, l.name
                            order by (select count(*) from shopping.list_items i where i.list_id = l.id) desc,
                                     l.is_default desc,
                                     l.created_at asc) as rn
    from shopping.shopping_lists l
   where l.name = 'הרשימה שלי' and l.archived_at is null
)
delete from shopping.shopping_lists
 where id in (select id from ranked where rn > 1 and item_count = 0 and not is_default);
