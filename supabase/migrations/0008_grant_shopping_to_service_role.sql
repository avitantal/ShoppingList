-- Grant service_role access to the shopping schema.
--
-- 0003 granted usage to anon + authenticated, but not service_role.
-- E2E uses service_role (via SUPABASE_SERVICE_ROLE_KEY) to bootstrap
-- test users and call shopping.create_list, and was failing with
-- "permission denied for schema shopping".

grant usage on schema shopping to service_role;

grant select, insert, update, delete
  on all tables in schema shopping to service_role;

grant execute on all functions in schema shopping to service_role;

alter default privileges in schema shopping
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema shopping
  grant execute on functions to service_role;
