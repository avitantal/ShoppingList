# Departments — Display by Supermarket Sections (with adaptive route learning)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group every shopping-list item into one of 13 supermarket departments (produce, dairy, …) and display the active list grouped by department in shopping-route order. The order itself becomes adaptive — the app learns the user's actual walking route from the order in which items are checked off, and offers to reorder the displayed departments to match.

**Architecture:** A curated Hebrew keyword classifier (`src/lib/departments.ts`, ~750 rules) assigns each catalog product to a department. The full catalog is pre-classified into `shopping.product_departments` by a one-off batch script (`scripts/classify-catalog.ts`); free-text items without a barcode fall back to running the classifier client-side. User corrections are persisted as `manual`-source rows in the same table. Department order starts as a static "shopping-route" default but can be per-user, learned from check-off sequences in past purchases.

**Tech stack:** TypeScript (no LLM, no external API), Postgres (additive migrations, RLS read-only catalog), React 19. The classifier file ships in the bundle and runs in microseconds.

**Supabase project:** `xgihixrhosbxyloeoxnv` (schema `shopping`). All migrations go through the `claude.ai Supabase` MCP with that project_id.

---

## File map

| File | Action | Responsibility | Status |
|---|---|---|---|
| `src/lib/departments.ts` | create | 13-department metadata + ~750 keyword rules + `classifyItem` | ✅ done |
| `src/test/lib/departments.test.ts` | create | Unit tests + false-positive regression guardrails | ✅ done |
| `supabase/migrations/0013_product_departments.sql` | create | Catalog-level classification table + RLS | ✅ done |
| `scripts/classify-catalog.ts` | create | One-off batch classifier over `shopping.products` | ✅ done |
| `supabase/migrations/0014_department_overrides_and_orders.sql` | create | `user_department_orders` + `set_department_override` RPC | - [ ] |
| `src/lib/departmentLookup.ts` | create | `getDepartmentForItem(item)` — barcode→catalog → name→classifier | - [ ] |
| `src/hooks/useDepartmentOrder.ts` | create | Reads per-user order, falls back to static default | - [ ] |
| `src/components/ActiveList.tsx` | modify | Render items grouped by department with collapsible sections | - [ ] |
| `src/components/DepartmentHeader.tsx` | create | Section header (name, count, collapse caret, est. total) | - [ ] |
| `src/components/ChangeDepartmentSheet.tsx` | create | Bottom-sheet picker for "שנה מחלקה" | - [ ] |
| `src/hooks/useCheckout.ts` | modify | After checkout, compute department sequence and stash it | - [ ] |
| `src/components/RouteSuggestionDialog.tsx` | create | "We noticed your route — update the display?" dialog | - [ ] |
| `src/test/lib/departmentLookup.test.ts` | create | Catalog hit / classifier fallback / override precedence | - [ ] |
| `src/test/components/ActiveList.test.tsx` | modify | Grouping render + collapse/expand behavior | - [ ] |
| `src/test/hooks/useCheckout.test.ts` | modify | Sequence capture from check-off order | - [ ] |
| `package.json` + UI version label | modify | Bump per phase | partial (→0.16.0) |

---

## Phase 1 — Dictionary + classifier ✅

Already shipped. Highlights:

- 13 departments + an `unclassified` bucket. See `DEPARTMENTS` in `src/lib/departments.ts`.
- ~750 keyword rules covering produce / bakery / dairy / meat-fish / deli / pantry / snacks / beverages / alcohol / frozen / cleaning / personal-care / baby.
- Substring matching with `exclude` lists and `priority` ties. Empirically: **86 % classified** on a random 300-item sample from the live catalog, with regression tests guarding the worst false-positive traps (טרה→אקסטרה, גיל→אביגיל, דאב→דאבל, שוקו vs שוקולד, פטה vs dog-food, etc.).

---

## Phase 2 — Catalog classification (DB + batch) ✅

Already shipped. Highlights:

- Migration `0013_product_departments.sql` creates `shopping.product_departments(barcode pk, department_code, source, …)`. RLS allows authenticated read; writes go through service-role only.
- `scripts/classify-catalog.ts` pages through `shopping.products`, runs `classifyItem` over `name + manufacturer`, upserts in 500-row chunks. Skips rows with `source = 'manual'` so user-curated entries survive re-runs.
- One pass against the live catalog (17,823 rows): 73.6 % classified, 26.4 % `unclassified`. The unclassified bucket is dominated by genuine non-grocery items (housewares, clothing, appliances, pet food) — these will be absorbed via either a future "Household" category or user overrides.

**Rerun trigger:** any non-trivial change to `src/lib/departments.ts`. Re-run is idempotent and respects `source='manual'`.

---

## Phase 3 — Display the list grouped by department

### Task 3A: Lookup helper (TDD)

**Files:**
- Create: `src/test/lib/departmentLookup.test.ts`
- Create: `src/lib/departmentLookup.ts`

The lookup resolves an item to a department in this precedence:
1. If `item.barcode` is set and matches a row in `shopping.product_departments` → use that row (whether `auto` or `manual`).
2. Otherwise → run `classifyItem(item.name)` in the client.
3. If still unresolved → `unclassified`.

- [ ] **Step 1: Write failing tests** — catalog hit (auto), catalog hit (manual wins over name-based guess), free-text fallback, missing barcode → classifyItem, all-empty → `unclassified`.
- [ ] **Step 2: Implement `getDepartmentForItem(item, catalogIndex)` and `useProductDepartments()` hook** that bulk-fetches needed rows from `shopping.product_departments` (only the barcodes present in the current list).
- [ ] **Step 3: Run tests.**
- [ ] **Step 4: Commit.**

### Task 3B: Group + render

**Files:**
- Modify: `src/components/ActiveList.tsx`
- Create: `src/components/DepartmentHeader.tsx`

- [ ] **Step 1: Decide collapse behavior**
  - **Option A:** flat list with section headers only (no collapse).
  - **Option B:** accordion with default-expanded sections, persisted per-user in `localStorage`.
  - **Option C:** flat by default + a single "collapse all" toggle.
  - Recommendation: B, but ship A first behind a feature flag if the implementation grows.
- [ ] **Step 2: Group items in `ActiveList` by `department_code`, ordered by either `DEPARTMENT_BY_CODE[code].order` (default) or the user's row in `user_department_orders` (Phase 4 once it exists; until then, default only).**
- [ ] **Step 3: Render `DepartmentHeader` per group**: name, item count, optional sum (`Σ price × qty` of priced items in that group only), expand/collapse caret if accordion.
- [ ] **Step 4: Items remain `ItemRow` as today** — no other ItemRow changes in this phase.
- [ ] **Step 5: Tests** — render 3 items across 2 departments, assert correct grouping + headers. Verify "לא מסווג" appears last regardless of order.
- [ ] **Step 6: Commit.**

### Task 3C: "Change department" UI

**Files:**
- Create: `src/components/ChangeDepartmentSheet.tsx`
- Modify: `src/components/ItemRow.tsx`

- [ ] **Step 1: Decision — entry point**
  - **Option A:** long-press → context menu with "שנה מחלקה".
  - **Option B:** three-dot menu next to each row (always visible).
  - **Option C:** swipe (conflicts with existing swipe-to-delete — avoid).
  - Recommendation: A. Don't add new chrome to each row.
- [ ] **Step 2: Implement bottom sheet listing 13 departments** with the current one preselected. Choosing a department triggers Step 3.
- [ ] **Step 3: Persist the correction**
  - If the item has a `barcode`: call new RPC `shopping.set_department_override(p_barcode, p_department_code)` → upserts `(barcode, department_code, source='manual')` into `product_departments`. **Affects all users.** This is intentional because the catalog is shared; a correction once is right forever.
  - If the item has no barcode: store a free-text mapping in `localStorage` keyed by normalized `item_name_key` (no separate DB table needed yet).
- [ ] **Step 4: Tests** — sheet rendering, RPC call shape, no-barcode fallback path.
- [ ] **Step 5: Commit.**

### Task 3D: Migration for Phase 3 RPC

**Files:**
- Create: `supabase/migrations/0014_department_overrides_and_orders.sql`

- [ ] **Step 1: Author migration with `set_department_override` RPC + `user_department_orders` table** (latter is for Phase 4 but ships in the same migration so the table is ready when we need it).

  ```sql
  create or replace function shopping.set_department_override(
    p_barcode         text,
    p_department_code text
  ) returns void
  language plpgsql security definer
  set search_path = shopping, public, auth
  as $$
  begin
    if auth.uid() is null then raise exception 'not authenticated'; end if;
    if not exists (select 1 from shopping.products where barcode = p_barcode) then
      raise exception 'product not found';
    end if;
    insert into shopping.product_departments (barcode, department_code, source)
      values (p_barcode, p_department_code, 'manual')
    on conflict (barcode) do update set
      department_code = excluded.department_code,
      source          = 'manual';
  end $$;

  grant execute on function shopping.set_department_override(text, text) to authenticated;

  create table if not exists shopping.user_department_orders (
    user_id          uuid not null references auth.users(id) on delete cascade,
    department_code  text not null,
    sort_order       integer not null,
    updated_at       timestamptz not null default now(),
    primary key (user_id, department_code)
  );

  alter table shopping.user_department_orders enable row level security;

  drop policy if exists user_department_orders_self on shopping.user_department_orders;
  create policy user_department_orders_self on shopping.user_department_orders
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

  grant select, insert, update, delete on shopping.user_department_orders to authenticated;
  ```
- [ ] **Step 2: Apply via Supabase MCP.**
- [ ] **Step 3: Smoke-test the RPC end-to-end from the client.**
- [ ] **Step 4: Commit migration.**

---

## Phase 4 — Smart Route Sorting (adaptive department order)

**Concept (per user input 2026-05-27):** The app learns the user's actual supermarket walking route by tracking the **order in which items get checked off** (`is_in_cart` flips to `true`). It does **not** look at the timestamps themselves — only the sequence. At checkout, if the observed department sequence differs from the displayed order, the app offers to reorder the displayed sections to match.

### Why this matters

- The static default order I authored is one person's mental model of a generic Israeli supermarket. Every user's real store is different. Per-user reorder via drag-and-drop is the obvious alternative but requires the user to consciously think about it. Smart Route Sorting is **passive**: the user keeps shopping as normal, the app learns.
- It complements (rather than replaces) Task 3 — the display is grouped from day one, but the order it's displayed in becomes increasingly personal.

### Algorithm

**Per-checkout (in `useCheckout`):**
1. Pull all `list_items` that were just checked into the cart.
2. Order them by `updated_at` ascending (the moment they were marked).
3. Map each item to its `department_code` via the Phase 3 lookup.
4. Collapse consecutive duplicates → a department sequence, e.g. `[produce, dairy, personal_care, cleaning, snacks]`.
5. Persist the sequence to a new table `shopping.checkout_routes(checkout_id, user_id, sequence text[], created_at)`. One row per checkout.

**Per-suggestion (after enough data):**
6. After ≥ **3** completed checkouts within the last 60 days, compute the **average position** of each department across runs.
   - For a department that appears in run N at position k (of L), its normalized position is `k / L`.
   - Average across all runs in which the department appeared.
   - Departments that never appeared get the static default position.
7. Sort departments by ascending average position → that's the suggested order.
8. If the suggested order differs from the current order (Hamming-ish: ≥3 swaps, or any swap moving by ≥2 positions), open `RouteSuggestionDialog`.
9. User accepts → upsert rows into `user_department_orders` with the new `sort_order`. The active list re-renders in the new order.
10. User declines → record the decline so we don't re-pester for at least the next 5 checkouts.

### Why "position-average" and not "Markov / most-likely-next"

Markov-chain modeling sounds more sophisticated but is fragile when sequences differ in length and content. Position-averaging is robust to:
- Skipping a department entirely on some trips (just doesn't contribute to that department's average).
- Different list sizes (normalized by length).
- A genuine refactor in route (the average shifts over time as old runs age out of the 60-day window).

### Tasks

#### Task 4A: Migration for the new table + index

**Files:**
- Create: `supabase/migrations/0015_checkout_routes.sql`

- [ ] **Step 1: Author migration**
  ```sql
  create table if not exists shopping.checkout_routes (
    id            bigserial primary key,
    user_id       uuid not null references auth.users(id) on delete cascade,
    checkout_id   uuid not null references shopping.purchase_events(id) on delete cascade,
    sequence      text[] not null,
    created_at    timestamptz not null default now()
  );
  create index if not exists checkout_routes_user_created_idx
    on shopping.checkout_routes(user_id, created_at desc);

  alter table shopping.checkout_routes enable row level security;
  create policy checkout_routes_self on shopping.checkout_routes
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  grant select, insert, delete on shopping.checkout_routes to authenticated;
  ```
  (Adjust `purchase_events` reference if the actual table name differs — confirm via `list_tables` first.)
- [ ] **Step 2: Apply + verify.**
- [ ] **Step 3: Commit.**

#### Task 4B: Capture sequence at checkout

**Files:**
- Modify: `src/hooks/useCheckout.ts`
- Modify: `src/test/hooks/useCheckout.test.ts`

- [ ] **Step 1: After a successful checkout, build the sequence:**
  - Pull the items that were in cart, ordered by `updated_at`.
  - Resolve each to a department using the same lookup as the display.
  - Drop consecutive duplicates.
  - Insert into `checkout_routes`.
- [ ] **Step 2: Test** — given 5 items with mocked `updated_at` and known departments, assert correct sequence.
- [ ] **Step 3: Commit.**

#### Task 4C: Compute suggestion + display dialog

**Files:**
- Create: `src/lib/routeSuggestion.ts` — pure function `suggestOrder(routes, defaults) → DepartmentCode[] | null`. Returns null if the suggestion is too close to the current order to bother.
- Create: `src/components/RouteSuggestionDialog.tsx`
- Modify: caller (probably `AppShell` or the checkout completion screen) to trigger the dialog after a checkout when conditions are met.

- [ ] **Step 1: TDD for `suggestOrder`** — feed it 3 fake runs, assert it averages positions correctly; feed it 0 runs, expect null; feed it 3 identical runs that already match the default, expect null.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Dialog UX** — show a side-by-side "current order" vs "suggested order" with the changed departments highlighted. Two buttons: "כן, עדכן" / "לא עכשיו".
- [ ] **Step 4: On accept**, upsert into `user_department_orders`. On decline, write a `localStorage` flag with a counter so we suppress for the next 5 checkouts.
- [ ] **Step 5: Tests** — dialog renders, accept calls upsert, decline writes the flag.
- [ ] **Step 6: Commit.**

#### Task 4D: Honor `user_department_orders` in the display

**Files:**
- Create: `src/hooks/useDepartmentOrder.ts`
- Modify: `src/components/ActiveList.tsx` (the grouping introduced in Task 3B)

- [ ] **Step 1: Hook fetches `user_department_orders` once per session for the current user.** If empty → return `DEPARTMENTS` in their default `order`. If non-empty → merge: explicit rows win, anything unmapped falls back to default order at the end.
- [ ] **Step 2: `ActiveList` uses the hook instead of importing `DEPARTMENTS` directly for sort order.**
- [ ] **Step 3: Test** — render with a mocked override (`dairy` placed first), assert dairy section is at the top.
- [ ] **Step 4: Commit.**

---

## Phase 5 — Cleanup / future

Items I deliberately *didn't* add yet, in declining priority:

- **"Household / other" department.** Right now ~26 % of catalog rows are `unclassified` because they're genuinely non-grocery (kitchenware, clothes, electronics, pet food). A 14th department could absorb most of them. Trigger: when "לא מסווג" becomes annoying in real usage.
- **Drag-to-reorder departments manually.** Smart Route Sorting should obviate this for the common case. Add only if Phase 4 turns out to misbehave or users want fine control.
- **Use Smart-Route data to improve the classifier itself.** If a free-text item without a barcode consistently appears in a specific department in the checkout sequence, that's a strong signal to add it to `departments.ts` (or persist a `name → department` override). Out of scope until Phase 4 has been running for a while.
- **Multi-store route profiles.** Currently one route per user. A user who shops at two different supermarkets has two real routes. Would need a "current store" selector at the start of shopping, plus a `store_id` column on `checkout_routes` and `user_department_orders`. Defer until at least one user asks.

---

## Self-review notes

- Phase 3 has 3 UX decisions (collapse mode, change-department entry point, override scope) that are noted as "decisions" rather than baked into the plan. Run them past Moria (UX) and Noa (frontend) before implementing Task 3B/3C.
- Phase 4 is intentionally drafted in detail because the algorithm is the meat of the feature. The actual numbers (3 checkouts threshold, 60-day window, ≥3 swap threshold) are educated guesses — leave them as named constants so they can be tuned after dogfooding.
- The Phase 3 override RPC sets `source='manual'` on a row that affects all users — this is deliberate (the catalog is shared) but worth flagging to the user before the migration goes out. There's no per-user-but-non-default override mechanism in this plan because it would double the storage and confuse the model.
- The Phase 4 sequence-capture path adds a write to every checkout; verify it doesn't introduce a perceptible lag. `checkout_routes` insert is one row, no JOINs — should be fast.
