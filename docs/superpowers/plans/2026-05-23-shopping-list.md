# Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-user, real-time shopping list web app per spec `2026-05-23-shopping-list-design.md`, located at `C:\Users\avita\Claude_Projects\ShoppingList`, mirroring the ProjectsManagerWeb stack.

**Architecture:** React 19 + TS + Vite + TailwindCSS (dark/RTL) on the front; Supabase Postgres (RLS + Realtime) on the back; Google OAuth via Supabase Auth using PKCE. Lists are flat (no scope tables); access governed by `owner_id` + `list_members` and a `is_list_member()` helper. Items are persistent templates; checkout creates immutable `purchase_events` + `purchase_event_items` snapshots via a server-side RPC.

**Tech Stack:** React 19, TypeScript ~6, Vite 8, Tailwind 3, Supabase JS 2, `@dnd-kit/*`, `react-swipeable`, `sonner`, `lucide-react`, `date-fns`, Vitest 4 + Testing Library, Playwright 1.60.

**Reference spec:** `C:\Users\avita\Claude_Projects\ShoppingList\docs\superpowers\specs\2026-05-23-shopping-list-design.md` (will be copied to the project dir as Task 0.1).

---

## File structure

```
C:\Users\avita\Claude_Projects\ShoppingList\
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json, tsconfig.app.json, tsconfig.node.json
├── eslint.config.js
├── index.html                          (RTL Hebrew shell)
├── playwright.config.ts
├── .env.example
├── README.md
├── docs/
│   ├── superpowers/specs/2026-05-23-shopping-list-design.md
│   ├── superpowers/plans/2026-05-23-shopping-list.md
│   └── MCP_GUIDE.md
├── supabase/
│   └── migrations/
│       └── 0001_init.sql               (full schema per spec §4–§6)
├── src/
│   ├── main.tsx
│   ├── App.tsx                         (top-level: auth gate + AppShell)
│   ├── index.css                       (Tailwind layers + globals)
│   ├── vite-env.d.ts
│   ├── lib/
│   │   ├── supabase.ts                 (client + types/enums)
│   │   ├── googleAuth.ts               (PKCE sign-in)
│   │   ├── format.ts                   (currency, date helpers)
│   │   └── utils.ts                    (cn helper)
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useLists.ts
│   │   ├── useListItems.ts             (+realtime)
│   │   ├── useCheckout.ts              (calls complete_checkout RPC)
│   │   └── usePurchaseHistory.ts
│   ├── components/
│   │   ├── Auth.tsx
│   │   ├── AppShell.tsx
│   │   ├── ListSidebar.tsx
│   │   ├── ActiveList.tsx
│   │   ├── ItemRow.tsx
│   │   ├── AddItemInput.tsx
│   │   ├── NewListDialog.tsx
│   │   ├── ShareDialog.tsx
│   │   ├── CheckoutDialog.tsx
│   │   └── HistoryView.tsx
│   └── test/
│       ├── setup.ts
│       ├── helpers/mockSupabase.ts
│       ├── lib/format.test.ts
│       ├── hooks/useLists.test.ts
│       ├── hooks/useListItems.test.ts
│       └── hooks/useCheckout.test.ts
└── e2e/
    ├── fixtures/seed.sql               (creates two test users + lists)
    ├── helpers/supabaseAdmin.ts        (service-role client for fixture cleanup)
    └── sharing.spec.ts                 (RLS + realtime two-user flow)
```

Boundaries: each `src/hooks/*` file owns one data concern and one realtime concern. Each `src/components/*` file is one self-contained UI unit. `lib/supabase.ts` is the only place that imports `@supabase/supabase-js` and exports the typed client + DB enums/types.

---

## Stage 0 — Project bootstrap

### Task 0.1: Scaffold Vite project and copy spec/plan in

**Files:**
- Create: `C:\Users\avita\Claude_Projects\ShoppingList\` (entire directory)
- Copy: spec + plan from `C:\Users\avita\.claude\projects\ShoppingList\docs\` into the new project

- [ ] **Step 1: Create the Vite TS project**

```bash
cd "/c/Users/avita/Claude_Projects"
npm create vite@latest ShoppingList -- --template react-ts
cd ShoppingList
```

Expected: `package.json`, `index.html`, `src/`, etc. created.

- [ ] **Step 2: Copy the spec and plan into the project**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp "/c/Users/avita/.claude/projects/ShoppingList/docs/superpowers/specs/2026-05-23-shopping-list-design.md" docs/superpowers/specs/
cp "/c/Users/avita/.claude/projects/ShoppingList/docs/superpowers/plans/2026-05-23-shopping-list.md" docs/superpowers/plans/
```

Expected: both files present under `docs/superpowers/`.

- [ ] **Step 3: Initialize git**

```bash
git init
git add -A
git commit -m "chore: vite + TS scaffold from create-vite; include spec and plan"
```

Expected: clean working tree.

### Task 0.2: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install @supabase/supabase-js @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities lucide-react sonner clsx tailwind-merge date-fns react-swipeable
```

- [ ] **Step 2: Install dev deps**

```bash
npm install -D tailwindcss@^3 postcss autoprefixer vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event playwright @types/node
```

- [ ] **Step 3: Add scripts to package.json**

Edit `package.json` so `scripts` reads:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "eslint .",
  "test": "vitest",
  "test:run": "vitest run --reporter=verbose",
  "e2e": "playwright test"
}
```

- [ ] **Step 4: Set version 0.1.0**

In `package.json`, set `"version": "0.1.0"`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add runtime and dev dependencies"
```

### Task 0.3: Configure Tailwind + RTL + dark tokens

**Files:**
- Create: `tailwind.config.js`, `postcss.config.js`, `src/index.css`
- Modify: `index.html`

- [ ] **Step 1: Initialize Tailwind config files**

```bash
npx tailwindcss init -p
```

- [ ] **Step 2: Replace `tailwind.config.js` with the PMW-mirrored tokens**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ['Heebo', 'system-ui', 'sans-serif'] },
      colors: {
        bg:      'rgb(10 10 12)',
        surface: 'rgb(20 20 24)',
        border:  'rgb(38 38 44)',
        muted:   'rgb(120 120 130)',
        text:    'rgb(235 235 240)',
        accent:  'rgb(99 102 241)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Replace `src/index.css`**

```css
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body {
  direction: rtl;
  background: rgb(10 10 12);
  color: rgb(235 235 240);
  font-family: 'Heebo', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

@layer components {
  .card { @apply bg-surface border border-border rounded-xl; }
  .btn { @apply inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors; }
  .btn-primary { @apply btn bg-accent hover:bg-indigo-500 text-white; }
  .btn-ghost { @apply btn hover:bg-surface text-muted hover:text-text; }
  .input { @apply w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent; }
  .badge { @apply inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium; }
}
```

- [ ] **Step 4: Replace `index.html`**

```html
<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0a0a0c" />
    <title>רשימת קניות</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Verify dev server boots**

```bash
npm run dev
```

Expected: Vite starts; open the URL — dark page, Hebrew font, RTL direction.

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.js postcss.config.js src/index.css index.html
git commit -m "feat: tailwind dark/RTL theme mirroring ProjectsManagerWeb"
```

### Task 0.4: Configure Vitest + test setup

**Files:**
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Replace `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
```

- [ ] **Step 2: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 3: Sanity run**

```bash
npm run test:run
```

Expected: "No test files found" — exits 0 (or harmless message). If Vitest errors on config, fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts src/test/setup.ts
git commit -m "test: vitest + testing-library setup"
```

### Task 0.5: ESLint config + .env.example + .gitignore additions

**Files:**
- Create: `eslint.config.js`, `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create `eslint.config.js`** (mirror PMW's structure)

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
```

- [ ] **Step 2: Install missing lint deps**

```bash
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals
```

- [ ] **Step 3: Create `.env.example`**

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
# Service-role key — ONLY used by e2e fixture scripts. Never commit a real value.
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 4: Append to `.gitignore`**

Append these lines:

```
.env
.env.local
playwright-report/
test-results/
```

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js .env.example .gitignore package.json package-lock.json
git commit -m "chore: eslint config, .env.example, ignore env+test artifacts"
```

---

## Stage 1 — Supabase client + types

### Task 1.1: Create the Supabase client (PKCE)

**Files:**
- Create: `src/lib/supabase.ts`

- [ ] **Step 1: Write the client**

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

// ---------- Domain types (mirror DB schema, see supabase/migrations/0001_init.sql) ----------

export type MemberRole = 'owner' | 'editor';
export type PurchaseSource = 'manual' | 'auto_inventory';

export interface ShoppingList {
  id: string;
  owner_id: string;
  name: string;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListMember {
  id: string;
  list_id: string;
  user_id: string | null;
  invited_email: string;
  role: MemberRole;
  invited_by: string;
  invited_at: string;
  joined_at: string | null;
}

export interface ListItem {
  id: string;
  list_id: string;
  name: string;
  qty: number;
  unit: string | null;
  notes: string | null;
  estimated_price: number | null;
  is_in_cart: boolean;
  sort_order: number;
  created_by: string | null;
  last_purchased_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseEvent {
  id: string;
  list_id: string;
  purchased_by: string;
  purchased_at: string;
  store_chain: string | null;
  store_branch: string | null;
  total_price: number | null;
  source: PurchaseSource;
  notes: string | null;
}

export interface PurchaseEventItem {
  id: string;
  event_id: string;
  list_item_id: string | null;
  name_snapshot: string;
  qty: number;
  unit_price: number | null;
  line_total: number | null;
}

export interface ListParticipant {
  list_id: string;
  user_id: string | null;
  email: string;
  role: MemberRole;
  joined_at: string | null;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: build succeeds (env vars not required at build time).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(supabase): pkce client + domain types mirroring the schema"
```

### Task 1.2: PKCE Google sign-in helper

**Files:**
- Create: `src/lib/googleAuth.ts`

- [ ] **Step 1: Write the helper**

```ts
import { supabase } from './supabase';

function getRedirectTo(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location.origin + window.location.pathname;
}

export async function signInWithGoogle(redirectTo = getRedirectTo()) {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : {},
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/googleAuth.ts
git commit -m "feat(auth): google sign-in via pkce"
```

### Task 1.3: Format + utils helpers (with tests)

**Files:**
- Create: `src/lib/format.ts`, `src/lib/utils.ts`, `src/test/lib/format.test.ts`

- [ ] **Step 1: Write failing test `src/test/lib/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { formatILS, normalizeStoreName } from '../../lib/format';

describe('formatILS', () => {
  it('formats integer shekels', () => {
    expect(formatILS(10)).toMatch(/10\.00.*₪|₪.*10\.00/);
  });
  it('formats decimals to two places', () => {
    expect(formatILS(6.9)).toMatch(/6\.90/);
  });
  it('returns dash for null/undefined', () => {
    expect(formatILS(null)).toBe('—');
    expect(formatILS(undefined)).toBe('—');
  });
});

describe('normalizeStoreName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeStoreName('  שופרסל   דיל  ')).toBe('שופרסל דיל');
  });
  it('returns empty string unchanged shape for empty input', () => {
    expect(normalizeStoreName('   ')).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- src/test/lib/format.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `src/lib/format.ts`**

```ts
const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatILS(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return ils.format(value);
}

export function normalizeStoreName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}
```

- [ ] **Step 4: Implement `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npm run test:run -- src/test/lib/format.test.ts
```

Expected: all 5 assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/format.ts src/lib/utils.ts src/test/lib/format.test.ts
git commit -m "feat(lib): currency + store-name helpers with tests"
```

---

## Stage 2 — Database migration

### Task 2.1: Write the complete migration SQL

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] **Step 1: Create directory**

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 2: Write `supabase/migrations/0001_init.sql`** — paste verbatim:

```sql
-- =====================================================================
-- Shopping List — initial schema (per spec 2026-05-23-shopping-list-design.md)
-- =====================================================================

-- 4.0 Prerequisites
create extension if not exists citext;
create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- 4.1 Enums
do $$ begin
  create type member_role as enum ('owner', 'editor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type purchase_source as enum ('manual', 'auto_inventory');
exception when duplicate_object then null; end $$;

-- 4.2 shopping_lists
create table if not exists shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists shopping_lists_one_default_per_owner
  on shopping_lists(owner_id) where is_default;
create index if not exists shopping_lists_active_owner_idx
  on shopping_lists(owner_id) where archived_at is null;
drop trigger if exists trg_shopping_lists_updated on shopping_lists;
create trigger trg_shopping_lists_updated before update on shopping_lists
  for each row execute function set_updated_at();

comment on table  shopping_lists is 'A named shopping list. Owned by one user; optionally shared with others via list_members.';
comment on column shopping_lists.is_default  is 'Exactly one default list per owner (partial unique index).';
comment on column shopping_lists.archived_at is 'Soft-delete marker. UI Delete = set this. Permanent delete is a separate RPC.';

-- 4.3 list_members
create table if not exists list_members (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references shopping_lists(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  invited_email citext not null,
  role          member_role not null default 'editor',
  invited_by    uuid not null references auth.users(id) on delete cascade,
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  unique (list_id, invited_email)
);
create index if not exists list_members_user_idx  on list_members(user_id);
create index if not exists list_members_email_idx on list_members(invited_email);

comment on table  list_members is 'Sharing rows. Owner is NOT duplicated here — see is_list_member() and v_list_participants.';
comment on column list_members.user_id is 'NULL until the invited email signs in for the first time (handle_new_user resolves it).';

-- 4.4 list_items
create table if not exists list_items (
  id                 uuid primary key default gen_random_uuid(),
  list_id            uuid not null references shopping_lists(id) on delete cascade,
  name               text not null,
  qty                numeric not null default 1 check (qty > 0),
  unit               text,
  notes              text,
  estimated_price    numeric(10,2) check (estimated_price is null or estimated_price >= 0),
  is_in_cart         boolean not null default false,
  sort_order         integer not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  last_purchased_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists list_items_list_sort_idx on list_items(list_id, sort_order);
drop trigger if exists trg_list_items_updated on list_items;
create trigger trg_list_items_updated before update on list_items
  for each row execute function set_updated_at();

comment on table  list_items is 'Persistent template items per list. is_in_cart is the SHARED current-cart state for the list (not personal).';
comment on column list_items.qty                is 'Desired quantity (template). Actual purchased qty lives in purchase_event_items.qty.';
comment on column list_items.is_in_cart         is 'Shared cart state for co-editing — when set, the item is considered "in the cart now" by everyone.';
comment on column list_items.last_purchased_at  is 'Denormalized — set by complete_checkout for fast UI ("נקנה לפני 3 ימים").';

-- 4.5 purchase_events
create table if not exists purchase_events (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references shopping_lists(id) on delete cascade,
  purchased_by  uuid not null references auth.users(id) on delete cascade,
  purchased_at  timestamptz not null default now(),
  store_chain   text,
  store_branch  text,
  total_price   numeric(10,2) check (total_price is null or total_price >= 0),
  source        purchase_source not null default 'manual',
  notes         text
);
create index if not exists purchase_events_list_time_idx
  on purchase_events(list_id, purchased_at desc);

comment on table  purchase_events is 'One "checkout" event. total_price is computed and written by complete_checkout — never by the client.';

-- 4.6 purchase_event_items
create table if not exists purchase_event_items (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references purchase_events(id) on delete cascade,
  list_item_id  uuid references list_items(id) on delete set null,
  name_snapshot text not null,
  qty           numeric not null check (qty > 0),
  unit_price    numeric(10,2) check (unit_price is null or unit_price >= 0),
  line_total    numeric(10,2) check (line_total is null or line_total >= 0)
);
create index if not exists purchase_event_items_event_idx on purchase_event_items(event_id);

comment on table  purchase_event_items is 'Snapshot lines of a checkout. line_total is computed server-side by complete_checkout.';

-- 4.8 Views
create or replace view v_list_participants as
  select l.id  as list_id,
         l.owner_id as user_id,
         (select email from auth.users where id = l.owner_id) as email,
         'owner'::member_role as role,
         l.created_at as joined_at
    from shopping_lists l
  union all
  select m.list_id,
         m.user_id,
         m.invited_email::text as email,
         m.role,
         m.joined_at
    from list_members m;

comment on view v_list_participants is 'Unified view of list owners + shared members. Use this in UI/MCP queries about "who has access".';

create or replace view v_monthly_purchase_summary as
  select l.owner_id,
         e.list_id,
         to_char(e.purchased_at, 'YYYY-MM') as year_month,
         count(*)                          as event_count,
         coalesce(sum(e.total_price), 0)   as total_spent
    from purchase_events e
    join shopping_lists l on l.id = e.list_id
   group by l.owner_id, e.list_id, year_month;

comment on view v_monthly_purchase_summary is 'Monthly spend per (owner, list). For reporting + MCP-driven questions like "how much did I spend last month?".';

create or replace view v_item_frequency as
  select l.owner_id,
         lower(pei.name_snapshot) as item_name,
         count(*)                 as purchases_90d,
         min(e.purchased_at)      as first_seen,
         max(e.purchased_at)      as last_seen
    from purchase_event_items pei
    join purchase_events e on e.id = pei.event_id
    join shopping_lists  l on l.id = e.list_id
   where e.purchased_at >= now() - interval '90 days'
   group by l.owner_id, lower(pei.name_snapshot);

comment on view v_item_frequency is 'Per-user item buy frequency in last 90 days. Foundation for phase-2 auto-list generation.';

-- 5. is_list_member helper + RLS
create or replace function is_list_member(p_list_id uuid) returns boolean
  language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from shopping_lists where id = p_list_id and owner_id = auth.uid()
    union all
    select 1 from list_members  where list_id = p_list_id and user_id = auth.uid()
  );
$$;

alter table shopping_lists       enable row level security;
alter table list_members         enable row level security;
alter table list_items           enable row level security;
alter table purchase_events      enable row level security;
alter table purchase_event_items enable row level security;

-- shopping_lists policies
drop policy if exists sl_select on shopping_lists;
create policy sl_select on shopping_lists for select
  using ( is_list_member(id) );

drop policy if exists sl_insert on shopping_lists;
create policy sl_insert on shopping_lists for insert
  with check ( owner_id = auth.uid() );

drop policy if exists sl_update on shopping_lists;
create policy sl_update on shopping_lists for update
  using       ( owner_id = auth.uid() )
  with check  ( owner_id = auth.uid() );  -- owner_id is immutable

drop policy if exists sl_delete on shopping_lists;
create policy sl_delete on shopping_lists for delete
  using ( owner_id = auth.uid() );

-- list_members policies
drop policy if exists lm_select on list_members;
create policy lm_select on list_members for select
  using ( is_list_member(list_id) );

drop policy if exists lm_owner_write on list_members;
create policy lm_owner_write on list_members for all
  using       ( exists (select 1 from shopping_lists where id = list_id and owner_id = auth.uid()) )
  with check  ( exists (select 1 from shopping_lists where id = list_id and owner_id = auth.uid()) );

-- list_items policies
drop policy if exists li_select on list_items;
create policy li_select on list_items for select using ( is_list_member(list_id) );
drop policy if exists li_insert on list_items;
create policy li_insert on list_items for insert with check ( is_list_member(list_id) );
drop policy if exists li_update on list_items;
create policy li_update on list_items for update
  using ( is_list_member(list_id) ) with check ( is_list_member(list_id) );
drop policy if exists li_delete on list_items;
create policy li_delete on list_items for delete using ( is_list_member(list_id) );

-- purchase_events policies
drop policy if exists pe_select on purchase_events;
create policy pe_select on purchase_events for select using ( is_list_member(list_id) );
drop policy if exists pe_insert on purchase_events;
create policy pe_insert on purchase_events for insert with check ( is_list_member(list_id) );
drop policy if exists pe_update on purchase_events;
create policy pe_update on purchase_events for update
  using ( purchased_by = auth.uid() ) with check ( purchased_by = auth.uid() );
drop policy if exists pe_delete on purchase_events;
create policy pe_delete on purchase_events for delete using ( purchased_by = auth.uid() );

-- purchase_event_items — access through event
drop policy if exists pei_select on purchase_event_items;
create policy pei_select on purchase_event_items for select using (
  exists (select 1 from purchase_events e where e.id = event_id and is_list_member(e.list_id))
);
drop policy if exists pei_insert on purchase_event_items;
create policy pei_insert on purchase_event_items for insert with check (
  exists (select 1 from purchase_events e where e.id = event_id and is_list_member(e.list_id))
);
drop policy if exists pei_update on purchase_event_items;
create policy pei_update on purchase_event_items for update
  using       ( exists (select 1 from purchase_events e where e.id = event_id and e.purchased_by = auth.uid()) )
  with check  ( exists (select 1 from purchase_events e where e.id = event_id and e.purchased_by = auth.uid()) );
drop policy if exists pei_delete on purchase_event_items;
create policy pei_delete on purchase_event_items for delete using (
  exists (select 1 from purchase_events e where e.id = event_id and e.purchased_by = auth.uid())
);

-- 4.9 Bootstrap trigger
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public, auth as $$
begin
  insert into shopping_lists (owner_id, name, is_default)
    values (new.id, 'הרשימה שלי', true);
  update list_members
     set user_id = new.id, joined_at = now()
   where invited_email = new.email and user_id is null;
  return new;
end $$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function handle_new_user();

-- 6. RPCs
create or replace function create_list(p_name text, p_make_default boolean default false)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if p_make_default then
    update shopping_lists set is_default = false where owner_id = auth.uid() and is_default;
  end if;
  insert into shopping_lists (owner_id, name, is_default)
    values (auth.uid(), p_name, p_make_default)
    returning id into v_id;
  return v_id;
end $$;
comment on function create_list is 'Create a new shopping list owned by the caller. If p_make_default, makes it the user''s default (clearing the previous default first).';

create or replace function archive_list(p_list_id uuid)
returns void language sql security invoker set search_path = public as $$
  update shopping_lists set archived_at = now()
   where id = p_list_id and owner_id = auth.uid();
$$;
comment on function archive_list is 'Soft-delete a list (owner only). UI default for "Delete".';

create or replace function delete_list_permanently(p_list_id uuid)
returns void language sql security invoker set search_path = public as $$
  delete from shopping_lists where id = p_list_id and owner_id = auth.uid();
$$;
comment on function delete_list_permanently is 'Hard-delete a list incl. items + history (cascade). Owner only. Hidden behind a confirmation in UI.';

create or replace function share_list(p_list_id uuid, p_email citext, p_role member_role default 'editor')
returns void language plpgsql security invoker set search_path = public, auth as $$
declare v_owner uuid; v_owner_email citext; v_resolved_user uuid;
begin
  select owner_id into v_owner from shopping_lists where id = p_list_id;
  if v_owner is null then raise exception 'list not found'; end if;
  if v_owner <> auth.uid() then raise exception 'only the owner can share'; end if;

  select email::citext into v_owner_email from auth.users where id = v_owner;
  if v_owner_email = p_email then
    return; -- no-op success: owner inviting themselves
  end if;

  select id into v_resolved_user from auth.users where email::citext = p_email;

  insert into list_members (list_id, user_id, invited_email, role, invited_by, joined_at)
    values (p_list_id, v_resolved_user, p_email, p_role, auth.uid(),
            case when v_resolved_user is not null then now() else null end)
  on conflict (list_id, invited_email)
    do update set role = excluded.role,
                  user_id  = coalesce(list_members.user_id, excluded.user_id),
                  joined_at = coalesce(list_members.joined_at, excluded.joined_at);
end $$;
comment on function share_list is 'Owner-only. Shares the list with the given email (creates a pending invite if no such user yet). No-op success if the email is the owner''s own.';

create or replace function unshare_list(p_list_id uuid, p_email citext)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from shopping_lists where id = p_list_id and owner_id = auth.uid()) then
    raise exception 'only the owner can unshare';
  end if;
  delete from list_members where list_id = p_list_id and invited_email = p_email;
end $$;
comment on function unshare_list is 'Owner-only. Removes a member (or a pending invite) by email.';

create or replace function add_item(
  p_list_id uuid,
  p_name text,
  p_qty numeric default 1,
  p_unit text default null,
  p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  insert into list_items (list_id, name, qty, unit, notes, created_by)
    values (p_list_id, p_name, p_qty, p_unit, p_notes, auth.uid())
    returning id into v_id;
  return v_id;
end $$;
comment on function add_item is 'Convenience RPC for MCP. Adds an item to the given list with the caller as created_by.';

create or replace function complete_checkout(
  p_list_id      uuid,
  p_store_chain  text,
  p_store_branch text,
  p_items        jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_event_id uuid;
  v_item     jsonb;
  v_list_item_id uuid;
  v_qty      numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_total    numeric := 0;
  v_purchased_item_ids uuid[] := '{}';
begin
  if not is_list_member(p_list_id) then raise exception 'not a member of list'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty JSON array';
  end if;

  insert into purchase_events (list_id, purchased_by, store_chain, store_branch)
    values (p_list_id, auth.uid(), nullif(btrim(p_store_chain), ''), nullif(btrim(p_store_branch), ''))
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
comment on function complete_checkout is 'Atomic checkout. Input: jsonb array of {list_item_id?, name, qty, unit_price?}. Computes line_total and total_price server-side. Clears is_in_cart and stamps last_purchased_at on purchased templates. Returns the new event id.';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): initial schema, RLS, RPCs, views, triggers per spec"
```

### Task 2.2: Apply the migration

**Prereqs:**
- Create a Supabase project at https://supabase.com (or use one the user already has).
- Enable Google as an OAuth provider in Supabase Auth settings. Set the redirect URL to the dev origin (e.g. `http://localhost:5173`).
- Populate `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Project Settings → API. Add `SUPABASE_SERVICE_ROLE_KEY` for fixture scripts (kept out of version control).

- [ ] **Step 1: Apply migration via Supabase SQL editor**

In the Supabase dashboard → SQL editor → paste the contents of `supabase/migrations/0001_init.sql` → Run. (If the Supabase CLI is set up locally, `supabase db push` is the equivalent.)

Expected: no errors. Sanity SQL:

```sql
select id, name, is_default, archived_at from shopping_lists;
select tablename from pg_policies where schemaname='public' order by tablename;
```

The second query should list policies for all five tables.

- [ ] **Step 2: Smoke-test the trigger**

Sign in to Supabase Studio with a Google account (or via SQL: invite a user). After signup, query:

```sql
select * from shopping_lists where name = 'הרשימה שלי';
```

Expected: one row per signed-in user.

- [ ] **Step 3: (No commit) — migration file already committed in 2.1.**

---

## Stage 3 — Auth flow

### Task 3.1: `useAuth` hook

**Files:**
- Create: `src/hooks/useAuth.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
    });

    return () => { sub.subscription.unsubscribe(); };
  }, []);

  return { session, loading };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAuth.ts
git commit -m "feat(auth): useAuth hook (session + loading)"
```

### Task 3.2: Auth screen

**Files:**
- Create: `src/components/Auth.tsx`

- [ ] **Step 1: Write the screen**

```tsx
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { signInWithGoogle } from '../lib/googleAuth';

export function Auth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true); setError(null);
    const { error } = await signInWithGoogle();
    if (error) { setError(error.message); setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🛒</div>
          <h1 className="text-xl font-semibold mb-1">רשימת קניות</h1>
          <p className="text-sm text-muted">היכנס עם חשבון Google שלך</p>
        </div>
        {error && <div className="text-xs text-red-400 text-center mb-4">{error}</div>}
        <button onClick={() => void go()} disabled={loading}
                className="btn-primary w-full justify-center gap-3 disabled:opacity-50 py-3">
          {loading ? <Loader2 className="animate-spin" size={18} /> : (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18"/>
              <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17"/>
              <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18z"/>
              <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31"/>
            </svg>
          )}
          {loading ? 'מתחבר...' : 'כניסה עם Google'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Auth.tsx
git commit -m "feat(auth): google sign-in screen"
```

---

## Stage 4 — Data hooks (TDD)

### Task 4.1: Mock Supabase helper

**Files:**
- Create: `src/test/helpers/mockSupabase.ts`

- [ ] **Step 1: Write the helper**

```ts
import { vi } from 'vitest';

export type Row = Record<string, unknown>;

export function makeMockClient(tables: Record<string, Row[]>, rpc: Record<string, (args: unknown) => unknown> = {}) {
  function from(table: string) {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {
      data: rows, error: null,
      select: vi.fn(() => chain),
      eq:     vi.fn(() => chain),
      order:  vi.fn(() => chain),
      is:     vi.fn(() => chain),
      then:   (cb: (r: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(cb),
    };
    return chain;
  }
  function channel() {
    return {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    };
  }
  function removeChannel() { /* noop */ }
  return {
    from,
    channel,
    removeChannel,
    rpc: vi.fn((name: string, args: unknown) => Promise.resolve({ data: rpc[name]?.(args) ?? null, error: null })),
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'u1', email: 'me@example.com' } } })) },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/test/helpers/mockSupabase.ts
git commit -m "test(helpers): mock supabase client for hook tests"
```

### Task 4.2: `useLists` hook (TDD)

**Files:**
- Create: `src/hooks/useLists.ts`, `src/test/hooks/useLists.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

vi.mock('../../lib/supabase', () => {
  const mock = makeMockClient({
    shopping_lists: [
      { id: 'L1', owner_id: 'u1', name: 'הרשימה שלי', is_default: true,  archived_at: null, created_at: 't', updated_at: 't' },
      { id: 'L2', owner_id: 'u1', name: 'שבועי',     is_default: false, archived_at: null, created_at: 't', updated_at: 't' },
      { id: 'L3', owner_id: 'u2', name: 'משפחתי',    is_default: false, archived_at: null, created_at: 't', updated_at: 't' },
    ],
    list_members: [
      { id: 'M1', list_id: 'L3', user_id: 'u1', invited_email: 'me@example.com', role: 'editor', invited_by: 'u2', invited_at: 't', joined_at: 't' },
    ],
  });
  return { supabase: mock };
});

beforeEach(() => vi.clearAllMocks());

describe('useLists', () => {
  it('partitions lists into owned vs shared', async () => {
    const { useLists } = await import('../../hooks/useLists');
    const { result } = renderHook(() => useLists());
    await waitFor(() => {
      expect(result.current.owned.map(l => l.id).sort()).toEqual(['L1','L2']);
      expect(result.current.shared.map(l => l.id)).toEqual(['L3']);
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- src/test/hooks/useLists.test.ts
```

- [ ] **Step 3: Implement `src/hooks/useLists.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase, type ShoppingList } from '../lib/supabase';

export function useLists() {
  const [owned, setOwned]   = useState<ShoppingList[]>([]);
  const [shared, setShared] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: user } = await supabase.auth.getUser();
    const uid = user?.user?.id;
    if (!uid) { setOwned([]); setShared([]); setLoading(false); return; }

    const { data: all } = await supabase
      .from('shopping_lists')
      .select('*')
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    const lists = (all ?? []) as ShoppingList[];
    setOwned( lists.filter(l => l.owner_id === uid));
    setShared(lists.filter(l => l.owner_id !== uid));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: react to membership changes for me
  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id;
      if (!uid || !alive) return;
      const ch = supabase
        .channel('lists:membership:' + uid)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'list_members', filter: `user_id=eq.${uid}` },
            () => { void refresh(); })
        .subscribe();
      return () => { supabase.removeChannel(ch); };
    });
    return () => { alive = false; };
  }, [refresh]);

  return { owned, shared, loading, refresh };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- src/test/hooks/useLists.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLists.ts src/test/hooks/useLists.test.ts
git commit -m "feat(hooks): useLists with owned/shared partition + realtime"
```

### Task 4.3: `useListItems` hook (TDD)

**Files:**
- Create: `src/hooks/useListItems.ts`, `src/test/hooks/useListItems.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

vi.mock('../../lib/supabase', () => ({
  supabase: makeMockClient({
    list_items: [
      { id: 'I1', list_id: 'L1', name: 'חלב 3%', qty: 1, unit: 'ליטר', notes: null, estimated_price: 6.90, is_in_cart: false, sort_order: 0, created_by: 'u1', last_purchased_at: null, created_at: 't', updated_at: 't' },
      { id: 'I2', list_id: 'L1', name: 'לחם',   qty: 1, unit: null,    notes: null, estimated_price: 7.00, is_in_cart: true,  sort_order: 1, created_by: 'u1', last_purchased_at: null, created_at: 't', updated_at: 't' },
    ],
  }),
}));

describe('useListItems', () => {
  it('returns items for the given list', async () => {
    const { useListItems } = await import('../../hooks/useListItems');
    const { result } = renderHook(() => useListItems('L1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.find(i => i.id === 'I2')?.is_in_cart).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- src/test/hooks/useListItems.test.ts
```

- [ ] **Step 3: Implement `src/hooks/useListItems.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase, type ListItem } from '../lib/supabase';

export function useListItems(listId: string | null) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!listId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('list_items')
      .select('*')
      .eq('list_id', listId)
      .order('sort_order', { ascending: true });
    setItems((data ?? []) as ListItem[]);
    setLoading(false);
  }, [listId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!listId) return;
    const ch = supabase
      .channel(`list:${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items',      filter: `list_id=eq.${listId}` }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_events', filter: `list_id=eq.${listId}` }, () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [listId, refresh]);

  async function addItem(name: string, qty = 1, unit: string | null = null) {
    if (!listId) return;
    await supabase.rpc('add_item', { p_list_id: listId, p_name: name, p_qty: qty, p_unit: unit });
    await refresh();
  }

  async function setInCart(itemId: string, inCart: boolean) {
    await supabase.from('list_items').update({ is_in_cart: inCart }).eq('id', itemId);
  }

  async function updateItem(itemId: string, patch: Partial<Pick<ListItem, 'name' | 'qty' | 'unit' | 'notes' | 'estimated_price' | 'sort_order'>>) {
    await supabase.from('list_items').update(patch).eq('id', itemId);
  }

  async function deleteItem(itemId: string) {
    await supabase.from('list_items').delete().eq('id', itemId);
  }

  return { items, loading, refresh, addItem, setInCart, updateItem, deleteItem };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- src/test/hooks/useListItems.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useListItems.ts src/test/hooks/useListItems.test.ts
git commit -m "feat(hooks): useListItems + mutations + realtime"
```

### Task 4.4: `useCheckout` hook (TDD)

**Files:**
- Create: `src/hooks/useCheckout.ts`, `src/test/hooks/useCheckout.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

const rpcSpy = vi.fn(() => 'EVT1');
vi.mock('../../lib/supabase', () => ({
  supabase: makeMockClient({}, { complete_checkout: rpcSpy }),
}));

describe('useCheckout', () => {
  it('calls complete_checkout RPC with normalized payload', async () => {
    const { useCheckout } = await import('../../hooks/useCheckout');
    const { result } = renderHook(() => useCheckout('L1'));
    await act(async () => {
      await result.current.checkout({
        storeChain: '  שופרסל  ',
        storeBranch: 'גבעתיים',
        items: [{ list_item_id: 'I1', name: 'חלב', qty: 1, unit_price: 6.9 }],
      });
    });
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const arg = rpcSpy.mock.calls[0][0] as { p_store_chain: string };
    expect(arg.p_store_chain).toBe('שופרסל');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- src/test/hooks/useCheckout.test.ts
```

- [ ] **Step 3: Implement `src/hooks/useCheckout.ts`**

```ts
import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { normalizeStoreName } from '../lib/format';

export interface CheckoutItemInput {
  list_item_id?: string;
  name: string;
  qty: number;
  unit_price?: number | null;
}

export function useCheckout(listId: string | null) {
  const [submitting, setSubmitting] = useState(false);

  async function checkout(input: { storeChain: string; storeBranch: string; items: CheckoutItemInput[] }) {
    if (!listId) return null;
    if (input.items.length === 0) { toast.error('אין פריטים בעגלה'); return null; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('complete_checkout', {
      p_list_id: listId,
      p_store_chain:  normalizeStoreName(input.storeChain),
      p_store_branch: normalizeStoreName(input.storeBranch),
      p_items: input.items.map(i => ({
        list_item_id: i.list_item_id ?? null,
        name: i.name,
        qty: i.qty,
        unit_price: i.unit_price ?? null,
      })),
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return null; }
    toast.success(`✅ נשמרו ${input.items.length} פריטים`);
    return data as string;
  }

  return { checkout, submitting };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- src/test/hooks/useCheckout.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCheckout.ts src/test/hooks/useCheckout.test.ts
git commit -m "feat(hooks): useCheckout (server-validated RPC)"
```

### Task 4.5: `usePurchaseHistory` hook

**Files:**
- Create: `src/hooks/usePurchaseHistory.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useCallback, useEffect, useState } from 'react';
import { supabase, type PurchaseEvent, type PurchaseEventItem } from '../lib/supabase';

export interface HistoryEntry extends PurchaseEvent { lines: PurchaseEventItem[]; }

export function usePurchaseHistory(listId: string | null) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!listId) { setEntries([]); return; }
    setLoading(true);
    const { data: events } = await supabase
      .from('purchase_events')
      .select('*')
      .eq('list_id', listId)
      .order('purchased_at', { ascending: false });
    const ev = (events ?? []) as PurchaseEvent[];
    if (ev.length === 0) { setEntries([]); setLoading(false); return; }
    const { data: items } = await supabase
      .from('purchase_event_items')
      .select('*')
      .in('event_id', ev.map(e => e.id));
    const byEvent = new Map<string, PurchaseEventItem[]>();
    (items ?? []).forEach((row) => {
      const r = row as PurchaseEventItem;
      const arr = byEvent.get(r.event_id) ?? [];
      arr.push(r);
      byEvent.set(r.event_id, arr);
    });
    setEntries(ev.map(e => ({ ...e, lines: byEvent.get(e.id) ?? [] })));
    setLoading(false);
  }, [listId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { entries, loading, refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/usePurchaseHistory.ts
git commit -m "feat(hooks): usePurchaseHistory (event + lines)"
```

---

## Stage 5 — UI components

### Task 5.1: `ItemRow`

**Files:**
- Create: `src/components/ItemRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { formatILS } from '../lib/format';
import { cn } from '../lib/utils';

interface Props {
  item: ListItem;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
}

export function ItemRow({ item, onToggle, onDelete }: Props) {
  const [revealed, setRevealed] = useState(false);
  const handlers = useSwipeable({
    onSwipedLeft:  () => setRevealed(true),
    onSwipedRight: () => setRevealed(false),
    trackMouse: true,
  });

  return (
    <div className="relative">
      <div className={cn('flex items-center gap-3 p-3 border-b border-border bg-bg transition-transform',
                         revealed && '-translate-x-16')}
           {...handlers}>
        <input type="checkbox" checked={item.is_in_cart}
               onChange={e => onToggle(e.target.checked)}
               className="w-5 h-5 accent-indigo-500" />
        <div className="flex-1 min-w-0">
          <div className={cn('text-sm font-medium truncate', item.is_in_cart && 'line-through text-muted')}>{item.name}</div>
          {(item.qty !== 1 || item.unit) && (
            <div className="text-xs text-muted">{item.qty}{item.unit ? ` ${item.unit}` : ''}</div>
          )}
        </div>
        <div className="text-xs text-muted whitespace-nowrap">{formatILS(item.estimated_price)}</div>
      </div>
      <button onClick={onDelete}
              className="absolute inset-y-0 left-0 w-16 bg-red-600/80 text-white flex items-center justify-center"
              aria-label="מחק פריט">
        <Trash2 size={18} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ItemRow.tsx
git commit -m "feat(ui): ItemRow with swipe-to-delete"
```

### Task 5.2: `AddItemInput`

**Files:**
- Create: `src/components/AddItemInput.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

interface Props { onAdd: (name: string) => Promise<void> | void; }

export function AddItemInput({ onAdd }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setBusy(true);
    await onAdd(v);
    setName('');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 p-2 border-b border-border bg-surface">
      <button type="submit" disabled={busy || !name.trim()} className="btn-ghost p-2" aria-label="הוסף פריט">
        <Plus size={18} />
      </button>
      <input value={name} onChange={e => setName(e.target.value)}
             placeholder="הוסף פריט..." className="input flex-1" />
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AddItemInput.tsx
git commit -m "feat(ui): AddItemInput inline form"
```

### Task 5.3: `ActiveList`

**Files:**
- Create: `src/components/ActiveList.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useMemo, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useListItems } from '../hooks/useListItems';
import { ItemRow } from './ItemRow';
import { AddItemInput } from './AddItemInput';
import { CheckoutDialog } from './CheckoutDialog';

interface Props { listId: string; }

export function ActiveList({ listId }: Props) {
  const { items, addItem, setInCart, deleteItem, refresh } = useListItems(listId);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const cartCount = useMemo(() => items.filter(i => i.is_in_cart).length, [items]);

  return (
    <div className="flex flex-col h-full">
      <AddItemInput onAdd={(name) => addItem(name)} />
      <div className="flex-1 overflow-y-auto">
        {items.length === 0
          ? <div className="text-center text-muted p-8 text-sm">הרשימה ריקה — הוסף את הפריט הראשון</div>
          : items.map(it => (
              <ItemRow key={it.id} item={it}
                       onToggle={(next) => setInCart(it.id, next)}
                       onDelete={() => deleteItem(it.id)} />
            ))}
      </div>
      {cartCount > 0 && (
        <div className="p-3 bg-surface border-t border-border sticky bottom-0">
          <button className="btn-primary w-full py-3 gap-2"
                  onClick={() => setCheckoutOpen(true)}>
            <ShoppingCart size={18} /> סיום קנייה ({cartCount})
          </button>
        </div>
      )}
      {checkoutOpen && (
        <CheckoutDialog listId={listId}
                        cartItems={items.filter(i => i.is_in_cart)}
                        onClose={() => setCheckoutOpen(false)}
                        onDone={() => { setCheckoutOpen(false); void refresh(); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ActiveList.tsx
git commit -m "feat(ui): ActiveList view"
```

### Task 5.4: `CheckoutDialog`

**Files:**
- Create: `src/components/CheckoutDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { useCheckout } from '../hooks/useCheckout';
import { formatILS } from '../lib/format';

interface Row { id: string; name: string; qty: number; unit_price: string; }
interface Props {
  listId: string;
  cartItems: ListItem[];
  onClose: () => void;
  onDone: () => void;
}

export function CheckoutDialog({ listId, cartItems, onClose, onDone }: Props) {
  const [storeChain, setStoreChain]   = useState('');
  const [storeBranch, setStoreBranch] = useState('');
  const [rows, setRows] = useState<Row[]>(cartItems.map(i => ({
    id: i.id, name: i.name, qty: Number(i.qty), unit_price: i.estimated_price?.toString() ?? '',
  })));
  const { checkout, submitting } = useCheckout(listId);

  const total = rows.reduce((s, r) => {
    const up = parseFloat(r.unit_price);
    return Number.isFinite(up) ? s + up * (r.qty || 0) : s;
  }, 0);

  async function submit() {
    const id = await checkout({
      storeChain, storeBranch,
      items: rows.map(r => ({
        list_item_id: r.id,
        name: r.name,
        qty: r.qty,
        unit_price: r.unit_price === '' ? null : parseFloat(r.unit_price),
      })),
    });
    if (id) onDone();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-2">
      <div className="card w-full max-w-md p-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-3">סיום קנייה</h2>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <input className="input" placeholder="רשת (לדוגמה: שופרסל)" value={storeChain}
                 onChange={e => setStoreChain(e.target.value)} />
          <input className="input" placeholder="סניף" value={storeBranch}
                 onChange={e => setStoreBranch(e.target.value)} />
        </div>
        <div className="border border-border rounded-lg overflow-hidden mb-3">
          <div className="grid grid-cols-[1fr_70px_90px] gap-2 px-3 py-2 text-xs text-muted bg-surface">
            <div>פריט</div><div>נקנה בפועל</div><div>מחיר ליחידה</div>
          </div>
          {rows.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-[1fr_70px_90px] gap-2 px-3 py-2 border-t border-border items-center">
              <div className="text-sm truncate">{r.name}</div>
              <input type="number" min={0} step="0.01" className="input py-1 text-sm"
                     value={r.qty}
                     onChange={e => setRows(rs => rs.map((x,i) => i===idx ? { ...x, qty: parseFloat(e.target.value) || 0 } : x))} />
              <input type="number" min={0} step="0.01" className="input py-1 text-sm"
                     value={r.unit_price}
                     onChange={e => setRows(rs => rs.map((x,i) => i===idx ? { ...x, unit_price: e.target.value } : x))} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted">סה"כ</span>
          <span className="text-lg font-semibold">{formatILS(total)}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>ביטול</button>
          <button className="btn-primary flex-1" disabled={submitting} onClick={() => void submit()}>
            {submitting ? 'שומר...' : 'אישור'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/CheckoutDialog.tsx
git commit -m "feat(ui): CheckoutDialog with per-row qty + price"
```

### Task 5.5: `NewListDialog`

**Files:**
- Create: `src/components/NewListDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

interface Props { onCreated: (id: string) => void; onClose: () => void; }

export function NewListDialog({ onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('create_list', { p_name: name.trim(), p_make_default: false });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    onCreated(data as string);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      <div className="card w-full max-w-sm p-4">
        <h2 className="text-lg font-semibold mb-3">רשימה חדשה</h2>
        <input autoFocus className="input mb-3" placeholder="שם הרשימה"
               value={name} onChange={e => setName(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>ביטול</button>
          <button className="btn-primary flex-1" disabled={busy} onClick={() => void create()}>צור</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/NewListDialog.tsx
git commit -m "feat(ui): NewListDialog"
```

### Task 5.6: `ShareDialog`

**Files:**
- Create: `src/components/ShareDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase, type ListParticipant } from '../lib/supabase';
import { toast } from 'sonner';

interface Props { listId: string; onClose: () => void; }

export function ShareDialog({ listId, onClose }: Props) {
  const [participants, setParticipants] = useState<ListParticipant[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('v_list_participants').select('*').eq('list_id', listId);
    setParticipants((data ?? []) as ListParticipant[]);
  }, [listId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function invite() {
    const v = email.trim();
    if (!v) return;
    setBusy(true);
    const { error } = await supabase.rpc('share_list', { p_list_id: listId, p_email: v, p_role: 'editor' });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setEmail('');
    toast.success('הוזמן');
    void refresh();
  }

  async function remove(p: ListParticipant) {
    if (p.role === 'owner') return;
    const { error } = await supabase.rpc('unshare_list', { p_list_id: listId, p_email: p.email });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      <div className="card w-full max-w-md p-4">
        <h2 className="text-lg font-semibold mb-3">שיתוף רשימה</h2>
        <div className="flex gap-2 mb-3">
          <input className="input flex-1" type="email" placeholder="someone@gmail.com"
                 value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn-primary" disabled={busy || !email.trim()} onClick={() => void invite()}>
            הזמן
          </button>
        </div>
        <ul className="border border-border rounded-lg divide-y divide-border">
          {participants.map(p => (
            <li key={p.email} className="flex items-center justify-between px-3 py-2">
              <div>
                <div className="text-sm">{p.email}</div>
                <div className="text-xs text-muted">
                  {p.role === 'owner' ? 'בעלים' : p.joined_at ? 'הצטרף' : 'ממתין'}
                </div>
              </div>
              {p.role !== 'owner' && (
                <button onClick={() => void remove(p)} className="text-muted hover:text-red-400" aria-label="הסר">
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 text-right">
          <button className="btn-ghost" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ShareDialog.tsx
git commit -m "feat(ui): ShareDialog using v_list_participants"
```

### Task 5.7: `ListSidebar`

**Files:**
- Create: `src/components/ListSidebar.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { Plus, History, ChevronLeft } from 'lucide-react';
import { useLists } from '../hooks/useLists';
import { NewListDialog } from './NewListDialog';
import { cn } from '../lib/utils';

interface Props {
  activeListId: string | null;
  onSelect: (id: string) => void;
  onOpenHistory: () => void;
  onClose: () => void;
}

export function ListSidebar({ activeListId, onSelect, onOpenHistory, onClose }: Props) {
  const { owned, shared, refresh } = useLists();
  const [creating, setCreating] = useState(false);

  return (
    <aside className="w-72 bg-surface border-l border-border h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="font-semibold">הרשימות שלי</h2>
        <button className="btn-ghost p-2" onClick={onClose} aria-label="סגור"><ChevronLeft size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <section className="p-2">
          <ul>
            {owned.map(l => (
              <li key={l.id}>
                <button className={cn('w-full text-right px-3 py-2 rounded-lg text-sm',
                                      activeListId === l.id ? 'bg-accent text-white' : 'hover:bg-bg')}
                        onClick={() => onSelect(l.id)}>
                  {l.name}{l.is_default && <span className="text-xs text-muted mr-2">(ברירת מחדל)</span>}
                </button>
              </li>
            ))}
          </ul>
          <button className="btn-ghost w-full mt-2 gap-2" onClick={() => setCreating(true)}>
            <Plus size={16} /> רשימה חדשה
          </button>
        </section>
        {shared.length > 0 && (
          <section className="p-2 border-t border-border">
            <h3 className="text-xs text-muted px-3 mb-2">ששותפו איתי</h3>
            <ul>
              {shared.map(l => (
                <li key={l.id}>
                  <button className={cn('w-full text-right px-3 py-2 rounded-lg text-sm',
                                        activeListId === l.id ? 'bg-accent text-white' : 'hover:bg-bg')}
                          onClick={() => onSelect(l.id)}>{l.name}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="p-2 border-t border-border">
        <button className="btn-ghost w-full gap-2" onClick={onOpenHistory}>
          <History size={16} /> היסטוריית קניות
        </button>
      </div>
      {creating && (
        <NewListDialog onClose={() => setCreating(false)}
                       onCreated={(id) => { setCreating(false); void refresh(); onSelect(id); }} />
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ListSidebar.tsx
git commit -m "feat(ui): ListSidebar (owned + shared + new + history)"
```

### Task 5.8: `HistoryView`

**Files:**
- Create: `src/components/HistoryView.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { usePurchaseHistory } from '../hooks/usePurchaseHistory';
import { formatILS } from '../lib/format';

interface Props { listId: string; onClose: () => void; }

export function HistoryView({ listId, onClose }: Props) {
  const { entries, loading } = usePurchaseHistory(listId);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-stretch justify-center p-2">
      <div className="card w-full max-w-2xl p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">היסטוריית קניות</h2>
          <button className="btn-ghost p-2" onClick={onClose}><X size={18} /></button>
        </div>
        {loading && <div className="text-muted text-sm">טוען...</div>}
        {!loading && entries.length === 0 && (
          <div className="text-muted text-sm text-center p-8">אין קניות עדיין</div>
        )}
        <ul className="space-y-2">
          {entries.map(e => (
            <li key={e.id} className="border border-border rounded-lg">
              <button className="w-full px-3 py-2 flex items-center justify-between"
                      onClick={() => setOpen(o => ({ ...o, [e.id]: !o[e.id] }))}>
                <div className="text-right">
                  <div className="text-sm font-medium">{format(new Date(e.purchased_at), 'dd/MM/yyyy HH:mm')}</div>
                  <div className="text-xs text-muted">
                    {[e.store_chain, e.store_branch].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{formatILS(e.total_price)}</span>
                  {open[e.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>
              {open[e.id] && (
                <ul className="border-t border-border divide-y divide-border">
                  {e.lines.map(l => (
                    <li key={l.id} className="px-3 py-2 flex items-center justify-between text-sm">
                      <span>{l.name_snapshot}</span>
                      <span className="text-muted">{l.qty} · {formatILS(l.line_total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HistoryView.tsx
git commit -m "feat(ui): HistoryView (events + lines, expandable)"
```

### Task 5.9: `AppShell`

**Files:**
- Create: `src/components/AppShell.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';
import { Menu, Share2 } from 'lucide-react';
import { useLists } from '../hooks/useLists';
import { ListSidebar } from './ListSidebar';
import { ActiveList } from './ActiveList';
import { ShareDialog } from './ShareDialog';
import { HistoryView } from './HistoryView';
import { supabase } from '../lib/supabase';

const LS_KEY = 'activeListId';

export function AppShell() {
  const { owned, shared, loading, refresh } = useLists();
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(LS_KEY));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shareOpen,  setShareOpen]  = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Default-select once lists arrive
  useEffect(() => {
    if (loading) return;
    const all = [...owned, ...shared];
    if (all.length === 0) return;
    if (!activeId || !all.some(l => l.id === activeId)) {
      const fallback = owned.find(l => l.is_default)?.id ?? all[0].id;
      setActiveId(fallback);
      localStorage.setItem(LS_KEY, fallback);
    }
  }, [loading, owned, shared, activeId]);

  function selectList(id: string) {
    setActiveId(id); localStorage.setItem(LS_KEY, id); setDrawerOpen(false);
  }

  // Refresh on sign-in (belt-and-braces per spec §8)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, _s) => { void refresh(); });
    return () => { sub.subscription.unsubscribe(); };
  }, [refresh]);

  const active = [...owned, ...shared].find(l => l.id === activeId) ?? null;
  const isOwner = !!owned.find(l => l.id === activeId);

  return (
    <div className="min-h-screen flex">
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          <ListSidebar activeListId={activeId} onSelect={selectList}
                       onOpenHistory={() => { setDrawerOpen(false); setHistoryOpen(true); }}
                       onClose={() => setDrawerOpen(false)} />
          <div className="flex-1 bg-black/40" onClick={() => setDrawerOpen(false)} />
        </div>
      )}
      <main className="flex-1 flex flex-col">
        <header className="flex items-center justify-between p-3 border-b border-border bg-surface">
          <button className="btn-ghost p-2" onClick={() => setDrawerOpen(true)} aria-label="פתח תפריט">
            <Menu size={20} />
          </button>
          <h1 className="font-semibold truncate">{active?.name ?? '—'}</h1>
          <button className="btn-ghost p-2" disabled={!isOwner} onClick={() => setShareOpen(true)} aria-label="שתף">
            <Share2 size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-hidden">
          {active ? <ActiveList listId={active.id} /> : <div className="p-8 text-center text-muted">טוען רשימות...</div>}
        </div>
      </main>
      {shareOpen && active && <ShareDialog listId={active.id} onClose={() => setShareOpen(false)} />}
      {historyOpen && active && <HistoryView listId={active.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AppShell.tsx
git commit -m "feat(ui): AppShell — drawer, header, share, history, persisted active list"
```

---

## Stage 6 — App wiring

### Task 6.1: `App.tsx` + `main.tsx` + toaster

**Files:**
- Modify: `src/App.tsx`, `src/main.tsx`

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { Loader2 } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { Auth } from './components/Auth';
import { AppShell } from './components/AppShell';

export default function App() {
  const { session, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-muted" size={24} /></div>;
  }
  return session ? <AppShell /> : <Auth />;
}
```

- [ ] **Step 2: Replace `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster position="top-center" richColors />
  </StrictMode>
);
```

- [ ] **Step 3: Build + run**

```bash
npm run build
npm run dev
```

Expected: build passes; the dev URL shows the Hebrew sign-in screen.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "feat(app): wire auth gate + AppShell + toaster"
```

### Task 6.2: End-to-end manual smoke (no e2e yet)

**Prereqs:** `.env.local` populated; Google OAuth configured in Supabase; migration applied.

- [ ] **Step 1: Sign in with a real Google account**

Expected: returns to the dev URL, sees the AppShell with "הרשימה שלי" as the active list (auto-created by `handle_new_user`).

- [ ] **Step 2: Add an item, check it, run checkout**

Add "חלב 3%" qty 1; check it; tap "סיום קנייה (1)"; fill chain "שופרסל"; price 6.90; confirm.

Expected: toast "✅ נשמרו 1 פריטים"; list shows "חלב 3%" unchecked; `purchase_events` has one row; `purchase_event_items` has one row with `line_total = 6.90` and `total_price = 6.90` on the parent event.

- [ ] **Step 3: Open History**

Expected: one entry dated today; expanding shows the line "חלב 3% · 1 · ₪6.90".

- [ ] **Step 4: Open Share, invite a second test email**

Expected: row appears as "ממתין". `select * from list_members` shows `user_id = null`.

- [ ] **Step 5: Sign in with that second email (incognito window)**

Expected: AppShell shows both "הרשימה שלי" (their own default) and the shared list under "ששותפו איתי" without manual refresh.

If anything fails, **stop and debug** before proceeding to e2e automation.

- [ ] **Step 6: Bump version + commit**

Set `package.json` version to `0.2.0`.

```bash
git add package.json
git commit -m "chore: bump to 0.2.0 after manual smoke passes"
```

---

## Stage 7 — Playwright e2e

### Task 7.1: Playwright config + fixture infra

**Files:**
- Create: `playwright.config.ts`, `e2e/helpers/supabaseAdmin.ts`, `e2e/fixtures/seed.sql`

- [ ] **Step 1: Install Playwright browsers**

```bash
npx playwright install chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 414, height: 896 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Write `e2e/helpers/supabaseAdmin.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.VITE_SUPABASE_URL!;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

export async function ensureUser(email: string, password: string): Promise<string> {
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing?.users.find(u => u.email === email);
  if (found) return found.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return data.user!.id;
}

export async function purgeListsForUser(userId: string) {
  await admin.from('shopping_lists').delete().eq('owner_id', userId);
}
```

(Install: `npm install -D dotenv`.)

- [ ] **Step 4: Write `e2e/fixtures/seed.sql`** — minimal cleanup script used by tests as needed (Playwright tests will mostly use the admin helper above instead):

```sql
-- Idempotent cleanup of e2e users' data — run from supabaseAdmin if needed.
-- (Placeholder; tests typically call purgeListsForUser instead.)
```

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/helpers/supabaseAdmin.ts e2e/fixtures/seed.sql package.json package-lock.json
git commit -m "test(e2e): playwright config + admin fixtures"
```

### Task 7.2: Sharing + realtime e2e

**Prereqs:** Supabase Auth → Email provider must be enabled (for the test users' password sign-in path). Two test addresses on a domain you control, e.g. `e2e-a@avita.test` / `e2e-b@avita.test`. Add both to `.env.local`:

```
E2E_USER_A_EMAIL=e2e-a@avita.test
E2E_USER_A_PASSWORD=...
E2E_USER_B_EMAIL=e2e-b@avita.test
E2E_USER_B_PASSWORD=...
```

**Files:**
- Create: `e2e/sharing.spec.ts`

- [ ] **Step 1: Add a password sign-in shortcut to the app for e2e only**

In `src/components/Auth.tsx`, append (gated by `import.meta.env.DEV`):

```tsx
{import.meta.env.DEV && (
  <details className="mt-6 text-xs text-muted">
    <summary>e2e sign-in</summary>
    <form className="mt-2 space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const { supabase } = await import('../lib/supabase');
      await supabase.auth.signInWithPassword({ email: String(f.get('email')), password: String(f.get('password')) });
    }}>
      <input name="email" placeholder="email" className="input" />
      <input name="password" type="password" placeholder="password" className="input" />
      <button className="btn-primary w-full" type="submit">Sign in (e2e)</button>
    </form>
  </details>
)}
```

- [ ] **Step 2: Write `e2e/sharing.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { admin, ensureUser, purgeListsForUser } from './helpers/supabaseAdmin';

const A = { email: process.env.E2E_USER_A_EMAIL!, password: process.env.E2E_USER_A_PASSWORD! };
const B = { email: process.env.E2E_USER_B_EMAIL!, password: process.env.E2E_USER_B_PASSWORD! };

test.describe.serial('sharing + realtime', () => {
  let aId: string; let bId: string;

  test.beforeAll(async () => {
    aId = await ensureUser(A.email, A.password);
    bId = await ensureUser(B.email, B.password);
    await purgeListsForUser(aId);
    await purgeListsForUser(bId);
    // Re-bootstrap default lists via trigger by creating one directly:
    await admin.rpc('create_list', { p_name: 'הרשימה שלי' }).single().throwOnError();
  });

  test('A creates a list, shares with B, B sees it and edits in realtime', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // A signs in
    await pageA.goto('/');
    await pageA.getByText('e2e sign-in').click();
    await pageA.locator('input[name=email]').fill(A.email);
    await pageA.locator('input[name=password]').fill(A.password);
    await pageA.getByRole('button', { name: /Sign in \(e2e\)/ }).click();
    await expect(pageA.getByText('הרשימה שלי')).toBeVisible();

    // A adds an item
    await pageA.locator('input[placeholder="הוסף פריט..."]').fill('חלב 3%');
    await pageA.locator('input[placeholder="הוסף פריט..."]').press('Enter');
    await expect(pageA.getByText('חלב 3%')).toBeVisible();

    // A shares with B
    await pageA.getByRole('button', { name: 'שתף' }).click();
    await pageA.locator('input[type=email]').fill(B.email);
    await pageA.getByRole('button', { name: 'הזמן' }).click();
    await expect(pageA.getByText(B.email)).toBeVisible();
    await pageA.getByRole('button', { name: 'סגור' }).click();

    // B signs in — should see the shared list
    await pageB.goto('/');
    await pageB.getByText('e2e sign-in').click();
    await pageB.locator('input[name=email]').fill(B.email);
    await pageB.locator('input[name=password]').fill(B.password);
    await pageB.getByRole('button', { name: /Sign in \(e2e\)/ }).click();
    await pageB.getByRole('button', { name: 'פתח תפריט' }).click();
    await expect(pageB.getByText('ששותפו איתי')).toBeVisible();
    await pageB.getByText('הרשימה שלי', { exact: false }).nth(1).click(); // shared one

    await expect(pageB.getByText('חלב 3%')).toBeVisible();

    // B checks the item — A sees the change in real time
    await pageB.locator('input[type=checkbox]').first().check();
    await expect(pageA.locator('input[type=checkbox]').first()).toBeChecked({ timeout: 5_000 });
  });
});
```

- [ ] **Step 3: Run**

```bash
npm run e2e -- e2e/sharing.spec.ts
```

Expected: green. If realtime assertion is flaky, increase the timeout up to 10s.

- [ ] **Step 4: Commit**

```bash
git add e2e/sharing.spec.ts src/components/Auth.tsx
git commit -m "test(e2e): sharing + realtime two-user flow"
```

---

## Stage 8 — Documentation

### Task 8.1: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

````markdown
# Shopping List

רשימת קניות שיתופית בזמן אמת — React 19 + Vite + Supabase.

## Setup

1. Create a Supabase project. Enable Google OAuth (Auth → Providers).
2. Copy `.env.example` → `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Add `SUPABASE_SERVICE_ROLE_KEY` if running e2e tests.
3. Apply the migration in `supabase/migrations/0001_init.sql` via the Supabase SQL editor (or `supabase db push` locally).
4. `npm install && npm run dev`.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run test` | Vitest watch |
| `npm run test:run` | Vitest single run |
| `npm run e2e` | Playwright e2e (needs `E2E_USER_*` env vars) |
| `npm run lint` | ESLint |

## Architecture

See `docs/superpowers/specs/2026-05-23-shopping-list-design.md` for the full spec and `docs/superpowers/plans/2026-05-23-shopping-list.md` for the implementation plan.

## MCP integration

See `docs/MCP_GUIDE.md` for connecting Claude to your own Supabase project via the Supabase MCP server.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README"
```

### Task 8.2: MCP guide

**Files:**
- Create: `docs/MCP_GUIDE.md`

- [ ] **Step 1: Write `docs/MCP_GUIDE.md`**

````markdown
# MCP Guide — Letting Claude manage your shopping data

This app's database is designed to be safely managed by Claude through the **Supabase MCP server**. RLS guarantees Claude can only see/modify data belonging to the signed-in user.

## Setup

1. In your Claude client (Claude Desktop or Claude Code), add the Supabase MCP server with your project URL and a service-role or anon key bound to your user.
2. Verify Claude can read the schema: ask *"What tables exist?"* — it should list `shopping_lists`, `list_items`, `purchase_events`, `purchase_event_items`, `list_members`, plus the views `v_list_participants`, `v_monthly_purchase_summary`, `v_item_frequency`.

## Useful prompts

- **Add an item:** "Add חלב 3% to my default list."
  Claude calls `add_item(p_list_id=<default>, p_name='חלב 3%', p_qty=1, p_unit='ליטר')`.
- **Spend report:** "How much did I spend on groceries last month?"
  Claude queries `v_monthly_purchase_summary`.
- **Frequency:** "What do I buy most often?"
  Claude queries `v_item_frequency`.
- **Share:** "Share my weekly list with partner@example.com."
  Claude calls `share_list(p_list_id=<weekly>, p_email='partner@example.com')`.

## Safety

- RLS enforces row ownership at the DB level — Claude cannot read data outside your user, even if asked.
- All write paths go through `SECURITY INVOKER` functions (`add_item`, `complete_checkout`, `share_list`, `unshare_list`, `archive_list`, `create_list`) — your user's permissions apply.
- The `delete_list_permanently` RPC is destructive; require an explicit confirmation in your prompt.
````

- [ ] **Step 2: Commit**

```bash
git add docs/MCP_GUIDE.md
git commit -m "docs: MCP guide with example prompts"
```

---

## Final pass

- [ ] **Step 1: Lint + tests + build**

```bash
npm run lint
npm run test:run
npm run build
```

Expected: all green.

- [ ] **Step 2: Bump version to 1.0.0 + commit**

Set `package.json` version to `1.0.0`.

```bash
git add package.json
git commit -m "chore: release 1.0.0"
```

- [ ] **Step 3: Final status**

```bash
git log --oneline
```

Expected: a clean, ordered history of feature commits with no fixups.

---

## Self-review notes (author)

- **Spec coverage:**
  - §3 stack → Tasks 0.2–0.5, 1.1.
  - §4 data model → Task 2.1 (single migration mirrors all of §4 + §5 + §6 + §4.9).
  - §5 RLS → Task 2.1 inline.
  - §6 RPCs → Task 2.1 inline + hook integration in Tasks 4.4, 5.5, 5.6.
  - §7 frontend → Tasks 3.x + 4.x + 5.x + 6.1.
  - §8 realtime → Tasks 4.2 (`useLists`), 4.3 (`useListItems`), 6.1 (sign-in refetch in AppShell).
  - §9 checkout flow → Task 5.4 + RPC in 2.1.
  - §10 MCP-readiness → Task 2.1 (`COMMENT ON …`) + Task 8.2.
  - §11 phase 2 → explicitly out of scope (no tasks).
  - §12 testing → Tasks 1.3, 4.x, 7.x.

- **Type/name consistency check:** `complete_checkout`, `add_item`, `share_list`, `unshare_list`, `create_list`, `archive_list`, `delete_list_permanently`, `is_list_member`, `v_list_participants`, `v_monthly_purchase_summary`, `v_item_frequency`, `handle_new_user`, `set_updated_at` — all spelled identically in migration, hooks, and components. `MemberRole`, `PurchaseSource`, `ShoppingList`, `ListMember`, `ListItem`, `PurchaseEvent`, `PurchaseEventItem`, `ListParticipant` — all defined once in `src/lib/supabase.ts` and reused.

- **Placeholder scan:** none found.

- **Open caveats for execution (not blockers):**
  - The e2e test relies on a dev-only password sign-in path (Task 7.2 step 1). If you don't want it in DEV builds, gate it behind an additional `VITE_E2E=1` env var.
  - Realtime ordering vs the post-share refetch in `useLists` is best verified by the e2e test, not unit tests.
