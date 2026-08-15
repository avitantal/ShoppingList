-- =====================================================================
-- 0021 — Restrict global catalog writes to admins (Eli review #2, NEW-1)
--
-- shopping.product_departments maps barcode -> department for EVERY user.
-- set_department_override is SECURITY DEFINER and only checked that the
-- caller was logged in, so any signed-up user could rewrite the department
-- of any product for the whole app, breaking category sorting and smart
-- route for everyone. Verified exploitable on the live database.
--
-- Fix: require app_admins membership (the same gate refresh_products_now
-- already uses) and reject anonymous identities explicitly. Non-admins are
-- not losing the feature: the app falls back to the existing per-device
-- name override, which yields the same result for that user.
--
-- Scope note: only 1 of 17,823 rows was ever 'manual', so this path is a
-- rare correction, not a daily flow. To grant it to another household
-- member: insert into shopping.app_admins (user_id) values ('<uuid>');
-- =====================================================================

create or replace function shopping.set_department_override(
  p_barcode text, p_department_code text
) returns void
language plpgsql security definer
set search_path to 'shopping', 'public', 'auth'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  -- Anonymous sign-ups also carry role 'authenticated'; they must never
  -- reach a global write path.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not permitted';
  end if;

  if not exists (select 1 from shopping.app_admins where user_id = auth.uid()) then
    raise exception 'only app admins can change the shared department mapping';
  end if;

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
end $function$;

revoke execute on function shopping.set_department_override(text, text) from public, anon;
grant execute on function shopping.set_department_override(text, text) to authenticated, service_role;
