-- =====================================================================
-- 0020 — Security hardening (Eli review, 2026-08-15)
-- Closes three live findings verified against the deployed database:
--   1) Functions had default PUBLIC EXECUTE (incl. SECURITY DEFINER
--      ingest_batch, callable unauthenticated with the anon key).
--   2) staging_prices / ingested_files / product_price_changes had RLS
--      disabled with full DML granted to authenticated (blanket
--      "alter default privileges" from 0003).
--   3) The three shopping views ran as owner (no security_invoker),
--      leaking every user's membership rows and email to any
--      authenticated user.
-- Also removes the drifted anon EXECUTE grant on create_list and stops
-- the default-privilege grants that caused 1) and 2) from applying to
-- future objects. Service-role pipeline (ingest_batch via GH Actions)
-- is unaffected: service_role bypasses RLS and keeps explicit grants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Functions: kill PUBLIC/anon EXECUTE everywhere; explicit grants only
-- ---------------------------------------------------------------------
revoke execute on all functions in schema shopping from public, anon;

-- Pipeline-only functions: not callable by app users at all.
revoke execute on function shopping.ingest_batch(text, text, text, jsonb, boolean) from authenticated;
revoke execute on function shopping.refresh_products_now(text) from authenticated;

-- Future functions: no built-in PUBLIC EXECUTE, no auto-grant to
-- authenticated — every new function gets an explicit grant or nothing.
alter default privileges in schema shopping revoke execute on functions from public;
alter default privileges in schema shopping revoke execute on functions from authenticated;

-- ---------------------------------------------------------------------
-- 2) Ingestion tables: enable RLS (no policies — service_role bypasses),
--    revoke app-role access, and stop auto-granting DML on future tables.
-- ---------------------------------------------------------------------
alter table shopping.staging_prices        enable row level security;
alter table shopping.ingested_files        enable row level security;
alter table shopping.product_price_changes enable row level security;

revoke all on shopping.staging_prices,
              shopping.ingested_files,
              shopping.product_price_changes
  from anon, authenticated;

alter default privileges in schema shopping
  revoke select, insert, update, delete on tables from authenticated;

-- ---------------------------------------------------------------------
-- 3) Views: security_invoker so underlying RLS applies to the caller.
--    v_list_participants embeds an auth.users email lookup the caller
--    cannot perform, so that lookup moves into a narrow SECURITY DEFINER
--    helper that only reveals the email of users sharing a list with
--    the caller (keeps ShareDialog working).
-- ---------------------------------------------------------------------
create or replace function shopping.participant_email(p_user_id uuid)
returns text
language sql stable security definer
set search_path = shopping, public, auth as $$
  select u.email::text
    from auth.users u
   where u.id = p_user_id
     and ( p_user_id = auth.uid()
           or exists (
             select 1 from shopping.shopping_lists l
              where ( l.owner_id = auth.uid()
                      or exists (select 1 from shopping.list_members m
                                  where m.list_id = l.id and m.user_id = auth.uid()) )
                and ( l.owner_id = p_user_id
                      or exists (select 1 from shopping.list_members m2
                                  where m2.list_id = l.id and m2.user_id = p_user_id) )
           ) );
$$;
revoke execute on function shopping.participant_email(uuid) from public, anon;
grant execute on function shopping.participant_email(uuid) to authenticated, service_role;

drop view if exists shopping.v_list_participants;
create view shopping.v_list_participants
with (security_invoker = on) as
  select l.id         as list_id,
         l.owner_id   as user_id,
         shopping.participant_email(l.owner_id) as email,
         'owner'::shopping.member_role as role,
         l.created_at as joined_at
    from shopping.shopping_lists l
  union all
  select m.list_id, m.user_id, m.invited_email::text as email, m.role, m.joined_at
    from shopping.list_members m;

alter view shopping.v_monthly_purchase_summary set (security_invoker = on);
alter view shopping.v_item_frequency           set (security_invoker = on);

-- Views are read-only surfaces: drop the DML grants they inherited.
revoke all on shopping.v_list_participants,
              shopping.v_monthly_purchase_summary,
              shopping.v_item_frequency
  from anon, authenticated;
grant select on shopping.v_list_participants,
                shopping.v_monthly_purchase_summary,
                shopping.v_item_frequency
  to authenticated, service_role;
