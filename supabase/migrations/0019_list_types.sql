-- Add list_type enum and column to shopping_lists.
-- Recreates create_list RPC to accept an optional p_list_type parameter.

set search_path = shopping;

create type shopping.list_type as enum ('shopping', 'checklist', 'note', 'log');

alter table shopping.shopping_lists
  add column list_type shopping.list_type not null default 'shopping';

-- Update create_list to accept an optional list type (default: shopping).
create or replace function create_list(
  p_name        text,
  p_make_default boolean default false,
  p_list_type   shopping.list_type default 'shopping'
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if p_make_default then
    update shopping.shopping_lists set is_default = false where owner_id = auth.uid() and is_default;
  end if;
  insert into shopping.shopping_lists (owner_id, name, is_default, list_type)
    values (auth.uid(), p_name, p_make_default, p_list_type)
    returning id into v_id;
  return v_id;
end $$;
