-- =====================================================================
-- 0013 — Catalog-level department classification.
--
-- Each product (barcode) is assigned to one shopping department. The
-- assignment is computed by a curated keyword classifier (see
-- src/lib/departments.ts) run by scripts/classify-catalog.ts. Rows with
-- source='manual' are protected from being overwritten by the auto run.
--
-- Companion to the per-item display by department feature.
-- =====================================================================

create table if not exists shopping.product_departments (
  barcode         text primary key references shopping.products(barcode) on delete cascade,
  department_code text not null,
  source          text not null default 'auto',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint product_departments_source_chk check (source in ('auto', 'manual'))
);

create index if not exists product_departments_dept_idx
  on shopping.product_departments(department_code);

drop trigger if exists trg_product_departments_updated on shopping.product_departments;
create trigger trg_product_departments_updated before update on shopping.product_departments
  for each row execute function shopping.set_updated_at();

alter table shopping.product_departments enable row level security;

-- Catalog data: any authenticated user can read; writes happen via the
-- service-role batch script only.
drop policy if exists product_departments_select on shopping.product_departments;
create policy product_departments_select on shopping.product_departments
  for select to authenticated
  using (true);

grant select on shopping.product_departments to authenticated;
