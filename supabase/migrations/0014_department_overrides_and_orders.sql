-- =====================================================================
-- 0014 — Manual department overrides + per-user department order.
--
-- 1. shopping.set_department_override(p_barcode, p_department_code):
--    upserts shopping.product_departments with source='manual'. The
--    catalog is shared across users, so a correction made by one user
--    benefits everyone. By design.
--
-- 2. shopping.user_department_orders: per-user sort_order override for
--    departments. Phase 4 (Smart Route Sorting) populates this; the
--    display reads from it, falling back to the static order baked into
--    src/lib/departments.ts.
-- =====================================================================

create or replace function shopping.set_department_override(
  p_barcode         text,
  p_department_code text
) returns void
language plpgsql security definer
set search_path = shopping, public, auth
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_barcode is null or p_barcode = '' then raise exception 'barcode is required'; end if;
  if p_department_code is null or p_department_code = '' then raise exception 'department_code is required'; end if;
  if not exists (select 1 from shopping.products p where p.barcode = p_barcode) then
    raise exception 'product not found for barcode %', p_barcode;
  end if;

  insert into shopping.product_departments (barcode, department_code, source)
    values (p_barcode, p_department_code, 'manual')
  on conflict (barcode) do update set
    department_code = excluded.department_code,
    source          = 'manual',
    updated_at      = now();
end $$;

revoke all on function shopping.set_department_override(text, text) from public;
grant execute on function shopping.set_department_override(text, text) to authenticated;

create table if not exists shopping.user_department_orders (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  department_code  text        not null,
  sort_order       integer     not null,
  updated_at       timestamptz not null default now(),
  primary key (user_id, department_code)
);

create index if not exists user_department_orders_user_idx
  on shopping.user_department_orders(user_id);

drop trigger if exists trg_user_department_orders_updated on shopping.user_department_orders;
create trigger trg_user_department_orders_updated before update on shopping.user_department_orders
  for each row execute function shopping.set_updated_at();

alter table shopping.user_department_orders enable row level security;

drop policy if exists user_department_orders_select on shopping.user_department_orders;
create policy user_department_orders_select on shopping.user_department_orders
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_department_orders_insert on shopping.user_department_orders;
create policy user_department_orders_insert on shopping.user_department_orders
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_department_orders_update on shopping.user_department_orders;
create policy user_department_orders_update on shopping.user_department_orders
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_department_orders_delete on shopping.user_department_orders;
create policy user_department_orders_delete on shopping.user_department_orders
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on shopping.user_department_orders to authenticated;
