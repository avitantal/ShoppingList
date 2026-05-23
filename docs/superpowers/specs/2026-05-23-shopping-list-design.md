# Shopping List — Design Spec

**Date:** 2026-05-23
**Status:** Approved for implementation planning
**Stack mirror:** `Claude_Projects/ProjectsManagerWeb` (React 19 + TS + Vite + Supabase)

---

## 1. Goal

A dynamic, multi-user shopping list web app that mirrors the ProjectsManagerWeb stack and visual language (Hebrew RTL, dark, mobile-first), with two new capabilities not present in PMW:

1. **Multiple named lists per user** (one default + as many additional lists as the user wants).
2. **Real-time co-editing by invitation** (share a list with another user by Gmail address).

It must also capture a **purchase history** with timestamp, store, and prices, and be **MCP-friendly** so a user can connect the Supabase MCP to Claude and let Claude manage their data directly.

A future phase (out of scope here, but architecturally accommodated) will add a **home inventory** and **auto-generated lists** derived from purchase history + inventory state.

## 2. Non-goals (this phase)

- Automatic price fetching from Israeli supermarket chains (planned phase 2 via MCP / public price feeds — see §11). Prices are entered manually for now.
- Home inventory and auto-generated shopping lists (planned phase 2).
- Read-only share links — only invitation-based co-editing is in scope.
- Calendar/Drive integrations from PMW (not relevant here — strip out).
- Non-Hebrew locales, non-ILS currencies.

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | React 19 + TypeScript | Same as PMW |
| Build | Vite | Same as PMW |
| Styling | TailwindCSS + dark theme + RTL | Reuse PMW's CSS tokens (`bg-accent`, `card`, `btn`, `text-muted`) |
| Backend | Supabase (Postgres + Auth + Realtime + RLS) | New Supabase project |
| Auth | Google OAuth via Supabase Auth, `flowType: 'pkce'` | Deviation from PMW: PMW uses implicit because of Google Calendar provider-token caching; we have no such need, so we pick the more secure modern default |
| Realtime | Supabase `postgres_changes` channels | Per-active-list subscription + global membership subscription |
| Icons | `lucide-react` | Same as PMW |
| Toasts | `sonner` | Same as PMW |
| Dates | `date-fns` | Same as PMW |
| DnD | `@dnd-kit/*` | For item reordering |
| Swipe | `react-swipeable` | Swipe-to-delete on item rows |
| Tests | Vitest + Testing Library; Playwright for live | Same as PMW |

**Persisted UI state in `localStorage`:** `activeListId` (the last-opened list).

**Key architectural deviation from PMW:** PMW uses table-prefix per scope (`factory_*` / `personal_*`). This app does not have scopes — all tables are flat and access is governed entirely by RLS over `owner_id` + `list_members`.

## 4. Data model

All identifiers are `uuid`. Money is `numeric(10,2)` in ILS. Every table and column gets `COMMENT ON …` for MCP discoverability.

### 4.0 Prerequisites

```sql
create extension if not exists citext;
create extension if not exists pgcrypto;  -- for gen_random_uuid()

-- Generic updated_at trigger reused by every table that has updated_at
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
```

### 4.1 Enums

```sql
create type member_role as enum ('owner', 'editor');
create type purchase_source as enum ('manual', 'auto_inventory');  -- 'auto_inventory' reserved for phase 2
```

### 4.2 `shopping_lists`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid → `auth.users` | Creator |
| `name` | text not null | e.g. "סופר שבועי" |
| `is_default` | bool not null default false | Exactly one per `owner_id` enforced by partial unique index |
| `archived_at` | timestamptz nullable | Soft delete — list is hidden from UI but history survives. UI's "Delete list" button archives by default. |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | `set_updated_at` trigger |

Indexes:
- `unique (owner_id) where is_default` (one default per user)
- `shopping_lists(owner_id) where archived_at is null`

### 4.3 `list_members` — sharing + pending invites

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `list_id` | uuid → `shopping_lists` on delete cascade | |
| `user_id` | uuid → `auth.users`, **nullable** | NULL = pending invite |
| `invited_email` | citext not null | Always populated; used to resolve pending invites |
| `role` | `member_role` not null default `'editor'` | |
| `invited_by` | uuid → `auth.users` | |
| `invited_at` | timestamptz default now() | |
| `joined_at` | timestamptz nullable | Set when `user_id` is resolved |

Constraint: `unique (list_id, invited_email)`. Indexes: `list_members(user_id)`, `list_members(invited_email)`. The list owner is **not** duplicated in this table — ownership lives in `shopping_lists.owner_id` and is resolved by the `is_list_member` helper (§5) and the `v_list_participants` view (§4.8). `list_members` rows always describe a sharing relationship (`role='editor'` in this phase).

**Pending-invite resolution:** trigger `handle_new_user()` on `auth.users` insert updates `list_members.user_id` and `joined_at` for every row where `invited_email = new.email and user_id is null`.

### 4.4 `list_items` — persistent templates (per design approach B)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `list_id` | uuid → `shopping_lists` on delete cascade | |
| `name` | text not null | "חלב 3%" |
| `qty` | numeric not null default 1 | **Desired** qty (template). Actual purchased qty lives in `purchase_event_items.qty`. UI label: "כמות רצויה". |
| `unit` | text nullable | "ליטר", "ק"ג" |
| `notes` | text nullable | |
| `estimated_price` | numeric(10,2) nullable | Manual now; phase-2 MCP-fed |
| `is_in_cart` | bool not null default false | **Shared** cart state, not personal — co-editors see the same checkboxes. Documented in §7.3. |
| `sort_order` | int not null default 0 | dnd-kit-friendly |
| `created_by` | uuid → `auth.users` nullable | Who added the item — useful in shared lists |
| `last_purchased_at` | timestamptz nullable | Denormalized; updated on checkout for UI ("נקנה לפני 3 ימים") |
| `created_at`, `updated_at` | timestamptz | `set_updated_at` trigger |

Constraints:
- `check (qty > 0)`
- `check (estimated_price is null or estimated_price >= 0)`

Index: `list_items(list_id, sort_order)`.

### 4.5 `purchase_events` — a "checkout"

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `list_id` | uuid → `shopping_lists` on delete cascade | |
| `purchased_by` | uuid → `auth.users` | Who hit "סיום קנייה" |
| `purchased_at` | timestamptz default now() | |
| `store_chain` | text nullable | "שופרסל", "רמי לוי" — free text for now (lookup table is a phase-2 cleanup) |
| `store_branch` | text nullable | |
| `total_price` | numeric(10,2) nullable | Sum of line totals; cached for fast list views. Computed and written by `complete_checkout`, not by the client. |
| `source` | `purchase_source` not null default `'manual'` | |
| `notes` | text nullable | |

Constraint: `check (total_price is null or total_price >= 0)`.

Index: `purchase_events(list_id, purchased_at desc)`.

### 4.6 `purchase_event_items` — snapshot of what was bought

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_id` | uuid → `purchase_events` on delete cascade | |
| `list_item_id` | uuid → `list_items`, **nullable**, on delete set null | Snapshot survives item deletion |
| `name_snapshot` | text not null | Item name at purchase time |
| `qty` | numeric not null | **Actual** purchased qty. UI label: "נקנה בפועל". |
| `unit_price` | numeric(10,2) nullable | |
| `line_total` | numeric(10,2) nullable | Computed server-side in `complete_checkout` as `qty * unit_price`; clients never write this directly. (Promotional overrides are a phase-2 concern — would add a `manual_line_total` column then.) |

Constraints:
- `check (qty > 0)`
- `check (unit_price is null or unit_price >= 0)`
- `check (line_total is null or line_total >= 0)`

Index: `purchase_event_items(event_id)`.

### 4.7 `home_inventory` *(phase 2 placeholder — not created in this phase)*

Documented here so the model is forward-compatible. Anticipated shape: `item_name`, `current_qty`, `min_threshold`, `last_used_at`, `owner_id`. Will feed `complete_checkout` to decrement quantities, and a future `generate_auto_list` function.

### 4.8 Views

- `v_list_participants` — union of the list owner and `list_members`, projected to `(list_id, user_id, email, role, joined_at)`. Owner row has `role='owner'`, `joined_at = shopping_lists.created_at`. Single source of truth for `ShareDialog`, audit, and MCP queries.
- `v_monthly_purchase_summary` — monthly totals per `(owner_id, list_id, year_month)`. For reporting and MCP queries.
- `v_item_frequency` — per `(owner_id, item_name)`: count and avg interval over last 90 days. Foundation for phase-2 auto-list generation.

### 4.9 Bootstrap trigger

`handle_new_user` runs on `auth.users` insert and does two things in a single transaction:
1. Creates a default list named **"הרשימה שלי"** with `owner_id = new.id`, `is_default = true`.
2. Resolves any pending invites: `update list_members set user_id = new.id, joined_at = now() where invited_email = new.email and user_id is null`.

This guarantees every authenticated user has at least one list and that incoming shares appear immediately on first sign-in.

## 5. RLS policies

Helper:

```sql
create function is_list_member(p_list_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from shopping_lists where id = p_list_id and owner_id = auth.uid()
    union all
    select 1 from list_members  where list_id = p_list_id and user_id = auth.uid()
  );
$$;
```

| Table | SELECT | INSERT | UPDATE/DELETE |
|---|---|---|---|
| `shopping_lists` | `is_list_member(id) and archived_at is null` (for default app reads — UI also has an "archived" view that omits the `archived_at is null` clause) | `owner_id = auth.uid()` | owner only; `owner_id` is immutable (enforced by UPDATE policy `with check (owner_id = auth.uid())`) |
| `list_items` | `is_list_member(list_id)` | `is_list_member(list_id)` | `is_list_member(list_id)` |
| `purchase_events` | `is_list_member(list_id)` | `is_list_member(list_id)` | `purchased_by = auth.uid()` |
| `purchase_event_items` | via join on event | via join | via join |
| `list_members` | members of the list | list owner only | list owner only |

All policies are enabled (`alter table … enable row level security`).

## 6. RPCs (Postgres functions)

Wrap multi-statement operations so the client (and any MCP-driven Claude) calls one function. Each carries `COMMENT ON FUNCTION` for MCP discovery.

- `create_list(p_name text, p_make_default bool default false) returns uuid`
  Creates a `shopping_lists` row with `owner_id = auth.uid()`. If `p_make_default` is true, unsets `is_default` on the caller's other lists and sets it on the new one (single transaction, respecting the partial unique index). Note: the first list per user is auto-created by `handle_new_user` (§4.9); this RPC is for additional lists.

- `archive_list(p_list_id uuid) returns void`
  Owner only. Sets `archived_at = now()`. UI default for "Delete list".

- `delete_list_permanently(p_list_id uuid) returns void`
  Owner only. Hard delete; cascades to `list_items` and `purchase_events`. Intended for an advanced/hidden UI action. Documented but used sparingly.

- `share_list(p_list_id uuid, p_email citext, p_role member_role default 'editor') returns void`
  Owner only. **No-op success** if `p_email` matches the owner's email. Otherwise inserts/updates a `list_members` row and resolves `user_id` immediately if a user with that email already exists.

- `unshare_list(p_list_id uuid, p_email citext) returns void`
  Owner only. Deletes the membership row.

- `complete_checkout(p_list_id uuid, p_store_chain text, p_store_branch text, p_items jsonb) returns uuid`
  Atomic. Input shape: `[{list_item_id?, name, qty, unit_price?}, ...]`. **Server-side validations**:
  - Caller is a member of `p_list_id` (otherwise raise).
  - Every non-null `list_item_id` must belong to `p_list_id` (raise on mismatch — prevents cross-list contamination).
  - `qty > 0`, `unit_price is null or unit_price >= 0`.
  - `line_total` is **computed server-side** as `qty * coalesce(unit_price, 0)` — never read from the client.
  - `total_price` on the event is the sum of computed line totals.
  - Items with `list_item_id` get `is_in_cart=false`, `last_purchased_at=now()` (a single UPDATE).
  - Items without `list_item_id` (ad-hoc purchases — bought something not on the list) are recorded only in `purchase_event_items` and do not create a template row.
  Returns the new `event_id`.

- `add_item(p_list_id uuid, p_name text, p_qty numeric default 1, p_unit text default null, p_notes text default null) returns uuid`
  Convenience for MCP — equivalent to a single INSERT but exposes a stable function signature. Sets `created_by = auth.uid()`.

## 7. Frontend architecture

### 7.1 Hooks

| Hook | Responsibility |
|---|---|
| `useAuth()` | Session + Google sign-in. Strip GCal logic from PMW's hook. |
| `useLists()` | `{ owned, shared, refresh }`. Global realtime subscription on `list_members` for current user. Also refetches explicitly on sign-in and after any `share_list`/`unshare_list`/`archive_list`/`create_list` call — realtime alone is not enough for the pending-invite-resolution case. Reads from `shopping_lists` filter out `archived_at is not null` by default. |
| `useListItems(listId)` | `{ items, refresh, mutations }`. Realtime subscription filtered by `list_id`. |
| `usePurchaseHistory(listId?)` | Lazy-loaded for `HistoryView`. |
| `useCheckout(listId)` | Calls `complete_checkout` RPC; toasts on success/error. |

### 7.2 Components

| File | Purpose |
|---|---|
| `Auth.tsx` | Google sign-in screen — copy/adapt from PMW |
| `AppShell.tsx` | Header (list name, share, menu) + drawer + main area |
| `ListSidebar.tsx` | "הרשימות שלי" + "ששותפו איתי" + "+ רשימה חדשה" + "היסטוריית קניות" |
| `ActiveList.tsx` | The active list view |
| `ItemRow.tsx` | Checkbox + name + qty/unit + price + swipe-to-delete |
| `AddItemInput.tsx` | Inline add at top of list |
| `CheckoutDialog.tsx` | Store chain/branch + per-item final qty/price → calls `useCheckout` |
| `ShareDialog.tsx` | Current members list + invite-by-email field + role |
| `NewListDialog.tsx` | Name + create |
| `HistoryView.tsx` | Purchase events grouped by date, expandable to lines |

### 7.3 UI rules

- RTL on `<html dir="rtl" lang="he">`.
- Dark theme via Tailwind tokens identical to PMW.
- Mobile-first: drawer collapses on small screens; checkout button is sticky-bottom on mobile.
- Currency formatting: `Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })`.
- **Naming discipline**: list-item qty is labeled "כמות רצויה"; checkout-row qty is labeled "נקנה בפועל". Reinforces the template-vs-actual model (§4.4 vs §4.6).
- **Shared cart semantics**: the in-cart checkbox is a *shared* state — when a co-editor checks "חלב", everyone sees it checked. This is correct for couples/roommates shopping together. A future personal-cart mode (separate per-user cart sessions) is out of scope for MVP.
- **Store inputs**: free-text `store_chain` and `store_branch`, with client-side `trim` + collapse-whitespace, and autocomplete from the caller's recent `purchase_events` (last 20 distinct chains/branches). No `stores` table in this phase.
- **"Delete list" button**: calls `archive_list`. A hidden "Delete permanently" exists only behind an explicit confirmation in an advanced menu.

## 8. Realtime

- **Per-active-list channel**: subscribed in `useListItems`, listens to `postgres_changes` on `list_items` and `purchase_events` filtered by `list_id`. On any change, **refetch the full slice** (no optimistic merge, no row-delta application — keeps logic simple and conflict-free for co-editing; lists are small so cost is negligible).
- **Global channel**: in `useLists`, listens to `list_members` changes for `user_id = auth.uid()` so a new share appears in the sidebar without a manual refresh.
- **Belt-and-braces refetches**: `useLists` also refetches on sign-in and after any mutation that touches membership/list state (`share_list`, `unshare_list`, `archive_list`, `create_list`). The `handle_new_user` trigger updates `list_members.user_id` for pending invites, and the subsequent UPDATE event is what the global channel listens for — but the explicit post-sign-in refetch guarantees the sidebar is correct even if the channel handshake is slower than the navigation.
- Cleanup: unsubscribe on `listId` change and on unmount.

## 9. Checkout flow (end-to-end)

1. User toggles `is_in_cart` on items via checkbox (realtime broadcasts to co-editors).
2. Sticky-bottom button "סיום קנייה (N)" appears when N ≥ 1 in-cart items.
3. Tap opens `CheckoutDialog`: store chain (free text + recent-stores autocomplete from `purchase_events`), store branch, and a per-item table where actual `qty` and `unit_price` can be edited (defaults from the item).
4. Confirm → `useCheckout` calls `complete_checkout` RPC.
5. On success: dialog closes, sonner toast ("✅ נשמרו N פריטים — סה"כ ₪…"), list refreshes (in-cart items now unchecked with updated `last_purchased_at`), unpurchased items stay as-is.
6. Realtime propagates the same final state to co-editors.

## 10. MCP readiness (Supabase MCP per-user)

A user connects their Supabase project's MCP to Claude and expects to say things like *"add milk to the main list"* or *"how much did I spend on groceries this month?"* and have it just work. Design implications:

1. **Self-describing schema**: `COMMENT ON TABLE` / `COMMENT ON COLUMN` / `COMMENT ON FUNCTION` everywhere. The MCP server exposes these to Claude.
2. **English snake_case names + enums** instead of magic strings — Claude generates more correct SQL.
3. **RPCs over multi-statement client code** — `complete_checkout`, `share_list`, `add_item` are single callable functions with documented signatures.
4. **RLS = safety by default**: a user's MCP credentials can only ever see/modify their own data + lists they're a member of.
5. **Reporting views** (`v_list_participants`, `v_monthly_purchase_summary`, `v_item_frequency`) give Claude pre-shaped answers for common questions without complex joins.
6. **Repo doc**: `docs/MCP_GUIDE.md` with setup steps for connecting the Supabase MCP and 5–10 example prompts.

## 11. Phase 2 (not built here, but planned for)

- **Automatic prices**: replace manual `estimated_price` entry with a fetcher that pulls from an Israeli price source (chp.co.il scrape, supermarket OData feeds, or a dedicated MCP). The `estimated_price` column already exists; only the fill mechanism changes.
- **Home inventory + auto-list**: `home_inventory` table; `complete_checkout` increments inventory; a `generate_auto_list(p_list_id)` RPC reads `v_item_frequency` + inventory thresholds to seed a new list.
- **Mail invites**: Edge Function to send a Gmail notification when `share_list` is called for a not-yet-registered email.
- **Read-only share links**: optional alternative to invitation-only.

## 12. Testing strategy (for the plan)

RLS + Realtime cannot be trusted on unit tests alone — they must be exercised end-to-end. The implementation plan must include:

- **Vitest** for pure helpers (currency formatting, store-name normalization, sort comparators).
- **Testing Library** for component logic with a mocked Supabase client.
- **Playwright** with two seeded Supabase test users (A and B) covering at minimum:
  - A creates a list and adds items — only A sees it.
  - A shares with B's email → B sees the list in "ששותפו איתי".
  - B checks an item; A's UI reflects it within ~1s (realtime).
  - A completes checkout; B sees `is_in_cart` cleared and history grows.
  - B tries to read a list they're not a member of → blocked by RLS.
- Test users seeded via a SQL fixture script run against a dedicated Supabase test project (separate from prod).

## 13. Open implementation questions (for the plan)

None blocking — all spec-level decisions are made. The plan will work out:
- Migration ordering and idempotency.
- Where exactly to place `set_updated_at` triggers (probably auto-generated for any table with `updated_at`).
- Whether `ShareDialog` shows pending vs accepted state distinctly in the UI (recommendation: yes, with a "ממתין/הצטרף" badge).

---

**Approved by:** user, 2026-05-23 (in conversation)
**Revised:** 2026-05-23, incorporating reviewer feedback (PKCE auth, `archived_at`, `v_list_participants`, `created_by` on items, server-side `line_total`, `handle_new_user` bootstrap, self-invite no-op, `qty>0` / `price>=0` constraints, `citext` + generic `set_updated_at` prerequisites, view rename to `v_monthly_purchase_summary`, refetch on sign-in + after share mutations, Playwright testing strategy).
