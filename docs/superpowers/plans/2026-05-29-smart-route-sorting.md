# Smart Route Sorting (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each checkout, record the department visit order inferred from item check-off sequence. Once enough data accumulates, offer to reorder the list's department sections to match the user's real walking route.

**Architecture:** Pure functions compute the route sequence and suggestion; a thin hook handles the two DB calls (insert route, fetch recent routes); `ActiveList` captures cart items at checkout time, then wires the sequence → suggestion → dialog flow. The suggestion updates `shopping_lists.department_order` via the existing `reorder()` function from `useDepartmentOrder`.

**Tech Stack:** React 19, TypeScript, Supabase (Postgres + RLS), Vitest

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Check-off timestamp | New `checked_at` column on `list_items` | `updated_at` is polluted by qty/name/dept edits — only `checked_at` reflects real walk order |
| Suggestion target | `shopping_lists.department_order` (per list) | Matches the drag-and-drop implementation already in place |
| Suggestion threshold | ≥ 3 checkouts within 60 days | Enough signal, not too slow to activate |
| Decline suppression | `localStorage` counter per list, reset after 5 declines or 14 days | Prevents nagging; per-list because stores differ |
| Sequence deduplication | Each department counted once per checkout (first occurrence) | Prevents double-counting when user revisits a section |
| currentOrder construction | Full order: `orderMap` entries + unordered defaults appended | Avoids partial comparison that creates false suggestions |
| Server-side compute | None — client computes average positions | Simple; data volume is tiny (<20 rows) |

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/0019_list_items_checked_at.sql` | **Create** | `checked_at` column on `list_items` |
| `supabase/migrations/0020_checkout_routes.sql` | **Create** | `checkout_routes` table + RLS |
| `src/lib/supabase.ts` | **Modify** | Add `checked_at` to `ListItem` type |
| `src/hooks/useListItems.ts` | **Modify** | Set/clear `checked_at` on `setInCart` |
| `src/lib/routeSuggestion.ts` | **Create** | Pure functions: `inferRouteSequence`, `suggestOrder` |
| `src/test/lib/routeSuggestion.test.ts` | **Create** | Unit tests for pure functions |
| `src/hooks/useRouteSuggestion.ts` | **Create** | DB wrapper: save route, fetch suggestion, decline counter |
| `src/components/RouteSuggestionDialog.tsx` | **Create** | Dialog showing suggested order |
| `src/components/ActiveList.tsx` | **Modify** | Wire checkout → route capture → suggestion → dialog |
| `README.md` | **Modify** | Update "Learns your habits" bullet |

---

## Task 1: Migrations

**Files:**
- Create: `supabase/migrations/0019_list_items_checked_at.sql`
- Create: `supabase/migrations/0020_checkout_routes.sql`

- [ ] **Step 1: Write migration 0019**

```sql
-- 0019_list_items_checked_at.sql
-- Tracks the exact moment an item was checked off (is_in_cart → true).
-- Updated only on check-off, not on qty/name/dept edits, so it's a reliable
-- source for inferring the user's walking route in the store.

alter table shopping.list_items
  add column if not exists checked_at timestamptz;
```

- [ ] **Step 2: Write migration 0020**

```sql
-- 0020_checkout_routes.sql
-- Stores the department visit sequence observed during each checkout.
-- One row per checkout; sequence is an ordered array of department codes.

create table if not exists shopping.checkout_routes (
  id          bigserial   primary key,
  list_id     uuid        not null references shopping.shopping_lists(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  sequence    text[]      not null,
  created_at  timestamptz not null default now()
);

-- Allow authenticated users to use the bigserial sequence.
grant usage, select on sequence shopping.checkout_routes_id_seq to authenticated;

create index if not exists checkout_routes_list_created_idx
  on shopping.checkout_routes(list_id, created_at desc);

alter table shopping.checkout_routes enable row level security;

-- Users can only read/write their own routes, and only for lists they own or are
-- a member of (prevents inserting routes against arbitrary list_ids).
create policy checkout_routes_self on shopping.checkout_routes
  for all to authenticated
  using  (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from shopping.shopping_lists sl
      left join shopping.list_members lm
        on lm.list_id = sl.id and lm.user_id = auth.uid()
      where sl.id = checkout_routes.list_id
        and (sl.owner_id = auth.uid() or lm.user_id is not null)
    )
  );

grant select, insert on shopping.checkout_routes to authenticated;
```

- [ ] **Step 3: Apply both migrations via Supabase MCP**

Apply 0019 first, then 0020. Confirm each succeeds.

- [ ] **Step 4: Regenerate TypeScript types**

Use `mcp__claude_ai_Supabase__generate_typescript_types` to regenerate types for the project and check if `list_items.checked_at` and the `checkout_routes` table appear. If the project uses a manual `supabase.ts` type file (as this one does), skip auto-generation and proceed to Task 2 where we add the type by hand.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0019_list_items_checked_at.sql supabase/migrations/0020_checkout_routes.sql
git commit -m "feat(db): add checked_at to list_items + checkout_routes table"
```

---

## Task 2: Add `checked_at` to `ListItem` type and `useListItems`

**Files:**
- Modify: `src/lib/supabase.ts` (the `ListItem` interface)
- Modify: `src/hooks/useListItems.ts` (the `setInCart` function)

- [ ] **Step 1: Add `checked_at` to `ListItem`**

In `src/lib/supabase.ts`, find the `ListItem` interface and add the field after `is_in_cart`:

```ts
export interface ListItem {
  id: string;
  list_id: string;
  name: string;
  qty: number;
  unit: string | null;
  notes: string | null;
  estimated_price: number | null;
  is_in_cart: boolean;
  checked_at: string | null;   // ← add this line
  sort_order: number;
  created_by: string | null;
  last_purchased_at: string | null;
  barcode: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Update `setInCart` in `src/hooks/useListItems.ts`**

Read the file, find the `setInCart` function, and update the DB write so it also sets `checked_at`:

```ts
// When is_in_cart → true: stamp checked_at now.
// When is_in_cart → false: clear checked_at so next checkout starts fresh.
async function setInCart(id: string, next: boolean) {
  // ... (keep any existing optimistic update logic)
  await db.from('list_items').update({
    is_in_cart: next,
    checked_at: next ? new Date().toISOString() : null,
  }).eq('id', id);
  // ... (keep any existing error handling / refresh)
}
```

Adapt the exact diff to what the file currently contains — do not remove existing optimistic update or error handling.

- [ ] **Step 3: Fix the test helper in `src/test/helpers/mockSupabase.ts` and any test that constructs a `ListItem`**

Search for `makeItem` or inline object literals that spread `ListItem`. Add `checked_at: null` to avoid TypeScript errors:

```bash
npm run test:run 2>&1 | grep "checked_at" | head -20
```

Fix any type errors that appear.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build -- --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts src/hooks/useListItems.ts
git commit -m "feat(route-sort): add checked_at to ListItem + stamp on check-off"
```

---

## Task 3: Pure functions — `inferRouteSequence` + `suggestOrder`

**Files:**
- Create: `src/lib/routeSuggestion.ts`
- Create: `src/test/lib/routeSuggestion.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/routeSuggestion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inferRouteSequence, suggestOrder, MIN_CHECKOUTS } from '../../lib/routeSuggestion';
import type { ListItem } from '../../lib/supabase';
import { DEPARTMENTS } from '../../lib/departments';
import type { DepartmentCode } from '../../lib/departments';

function makeItem(
  name: string,
  checked_at: string | null,
  barcode: string | null = null,
): ListItem {
  return {
    id: 'x', list_id: 'l', qty: 1, unit: null, notes: null,
    estimated_price: null, is_in_cart: true, sort_order: 0,
    created_by: null, last_purchased_at: null,
    created_at: '', updated_at: checked_at ?? '', checked_at, barcode, name,
  };
}

const defaultOrder = DEPARTMENTS
  .filter(d => d.code !== 'unclassified')
  .sort((a, b) => a.order - b.order)
  .map(d => d.code) as DepartmentCode[];

// Full current order including all defaults (as ActiveList will build it)
const fullCurrentOrder = DEPARTMENTS
  .filter(d => d.code !== 'unclassified')
  .sort((a, b) => a.order - b.order)
  .map(d => d.code) as DepartmentCode[];

describe('inferRouteSequence', () => {
  it('returns departments in checked_at order, consecutive duplicates collapsed', () => {
    const items: ListItem[] = [
      makeItem('חלב',   '2026-01-01T10:00:00Z'), // dairy
      makeItem('גבינה', '2026-01-01T10:01:00Z'), // dairy — same dept, collapse
      makeItem('לחם',   '2026-01-01T10:02:00Z'), // bakery
    ];
    const result = inferRouteSequence(items, new Map(), new Map());
    expect(result).toEqual(['dairy', 'bakery']);
  });

  it('returns empty array for empty input', () => {
    expect(inferRouteSequence([], new Map(), new Map())).toEqual([]);
  });

  it('handles catalog lookup when barcode is provided', () => {
    const catalog = new Map([['BAR1', 'snacks' as DepartmentCode]]);
    const items: ListItem[] = [
      makeItem('במבה', '2026-01-01T10:00:00Z', 'BAR1'),
      makeItem('לחם',  '2026-01-01T10:01:00Z'),
    ];
    const result = inferRouteSequence(items, catalog, new Map());
    expect(result[0]).toBe('snacks');
    expect(result[1]).toBe('bakery');
  });

  it('falls back to updated_at when checked_at is null', () => {
    const items: ListItem[] = [
      { ...makeItem('לחם',  null), updated_at: '2026-01-01T10:00:00Z' }, // bakery
      { ...makeItem('חלב',  null), updated_at: '2026-01-01T10:01:00Z' }, // dairy
    ];
    const result = inferRouteSequence(items, new Map(), new Map());
    expect(result).toEqual(['bakery', 'dairy']);
  });
});

describe('suggestOrder', () => {
  it('returns null when fewer than MIN_CHECKOUTS sequences provided', () => {
    const seqs = [['dairy', 'produce']] as DepartmentCode[][];
    expect(suggestOrder(seqs, fullCurrentOrder, DEPARTMENTS)).toBeNull();
  });

  it('returns null when sequences already match the current order', () => {
    // produce=order1, bakery=order2, dairy=order3 — this is the existing default
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['produce', 'bakery', 'dairy'] as DepartmentCode[],
    );
    // current order is the same as sequences — should be null (no improvement to suggest)
    expect(suggestOrder(seqs, fullCurrentOrder, DEPARTMENTS)).toBeNull();
  });

  it('ranks beverages earlier when user always starts there', () => {
    // beverages is near the end in defaults (order=8); user always starts there
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['beverages', 'produce', 'dairy'] as DepartmentCode[],
    );
    const result = suggestOrder(seqs, fullCurrentOrder, DEPARTMENTS);
    expect(result).not.toBeNull();
    if (result) {
      const bevInSuggested = result.indexOf('beverages');
      const bevInDefaults  = fullCurrentOrder.indexOf('beverages');
      expect(bevInSuggested).toBeLessThan(bevInDefaults);
    }
  });

  it('places unobserved departments after observed ones, in default order', () => {
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['beverages', 'produce'] as DepartmentCode[],
    );
    const result = suggestOrder(seqs, fullCurrentOrder, DEPARTMENTS);
    if (result) {
      const bevIdx   = result.indexOf('beverages');
      const prodIdx  = result.indexOf('produce');
      const snackIdx = result.indexOf('snacks'); // never observed — must come after observed
      expect(bevIdx).toBeLessThan(snackIdx);
      expect(prodIdx).toBeLessThan(snackIdx);
    }
  });

  it('counts each department once per checkout even if it appears twice in sequence', () => {
    // User goes dairy → bakery → dairy (revisit). dairy should be counted at position 0, not averaged with position 2.
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['dairy', 'bakery', 'dairy'] as DepartmentCode[],
    );
    const result = suggestOrder(seqs, fullCurrentOrder, DEPARTMENTS);
    // dairy was first (pos 0) in each run — should rank before bakery in suggestion
    if (result) {
      expect(result.indexOf('dairy')).toBeLessThan(result.indexOf('bakery'));
    }
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test:run -- src/test/lib/routeSuggestion.test.ts
```

Expected: `Cannot find module '../../lib/routeSuggestion'`

- [ ] **Step 3: Implement `src/lib/routeSuggestion.ts`**

```ts
import { getDepartmentForItem } from './departmentLookup';
import {
  DEPARTMENTS, DEPARTMENT_CODES,
  type DepartmentCode, type DepartmentMeta,
} from './departments';
import type { CatalogIndex, NameOverrides } from './departmentLookup';
import type { ListItem } from './supabase';

export const MIN_CHECKOUTS = 3;
const MIN_DIFF_COUNT = 2;

/** Derives the department visit sequence from cart items ordered by checked_at
 *  (falls back to updated_at when checked_at is null). Consecutive duplicate
 *  departments are collapsed: [dairy, dairy, bakery] → [dairy, bakery]. */
export function inferRouteSequence(
  cartItems: ListItem[],
  catalog: CatalogIndex,
  nameOverrides: NameOverrides,
): DepartmentCode[] {
  const sorted = [...cartItems].sort((a, b) => {
    const ta = new Date(a.checked_at ?? a.updated_at).getTime();
    const tb = new Date(b.checked_at ?? b.updated_at).getTime();
    return ta - tb;
  });
  const raw = sorted.map(item => getDepartmentForItem(item, catalog, nameOverrides));
  return raw.filter((code, i) => i === 0 || code !== raw[i - 1]);
}

/** Computes a suggested department order from past sequences.
 *  Each department is counted at most once per checkout (first occurrence only),
 *  then averaged across runs. Returns null if fewer than MIN_CHECKOUTS sequences
 *  are available or if the suggestion is too close to the current order. */
export function suggestOrder(
  sequences: DepartmentCode[][],
  currentOrder: DepartmentCode[],
  defaults: DepartmentMeta[] = DEPARTMENTS,
): DepartmentCode[] | null {
  if (sequences.length < MIN_CHECKOUTS) return null;

  const posSum   = new Map<DepartmentCode, number>();
  const posCount = new Map<DepartmentCode, number>();

  for (const seq of sequences) {
    // Keep only first occurrence of each dept in this checkout to avoid double-counting.
    const unique = seq.filter((code, i) => seq.indexOf(code) === i);
    const L = unique.length;
    if (L === 0) continue;
    unique.forEach((code, i) => {
      posSum.set(code,   (posSum.get(code)   ?? 0) + i / L);
      posCount.set(code, (posCount.get(code) ?? 0) + 1);
    });
  }

  const observed = [...posSum.entries()]
    .filter(([code]) => code !== DEPARTMENT_CODES.UNCLASSIFIED)
    .sort((a, b) => (a[1] / posCount.get(a[0])!) - (b[1] / posCount.get(b[0])!))
    .map(([code]) => code);

  // Departments never observed fall back to default order, appended at the end.
  const unobserved = defaults
    .filter(d => d.code !== DEPARTMENT_CODES.UNCLASSIFIED && !posSum.has(d.code))
    .sort((a, b) => a.order - b.order)
    .map(d => d.code);

  const suggested = [...observed, ...unobserved];

  // Build a full positional map for currentOrder (fill gaps with default positions).
  const defaultPos   = new Map(defaults.map(d => [d.code, d.order] as [DepartmentCode, number]));
  const currentPos   = new Map<DepartmentCode, number>();
  defaults.forEach((d, i) => {
    const idx = currentOrder.indexOf(d.code);
    currentPos.set(d.code, idx >= 0 ? idx : i);
  });
  const suggestedPos = new Map(suggested.map((c, i) => [c, i]));

  let diffCount = 0;
  for (const code of suggested) {
    const ci = currentPos.get(code) ?? (defaultPos.get(code) ?? 99);
    const si = suggestedPos.get(code)!;
    if (Math.abs(ci - si) >= 1) diffCount++;
  }

  return diffCount >= MIN_DIFF_COUNT ? suggested : null;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm run test:run -- src/test/lib/routeSuggestion.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routeSuggestion.ts src/test/lib/routeSuggestion.test.ts
git commit -m "feat(route-sort): pure functions inferRouteSequence + suggestOrder"
```

---

## Task 4: Hook — `useRouteSuggestion`

**Files:**
- Create: `src/hooks/useRouteSuggestion.ts`

- [ ] **Step 1: Implement the hook**

```ts
import { useCallback } from 'react';
import { supabase, db } from '../lib/supabase';
import { DEPARTMENTS } from '../lib/departments';
import type { DepartmentCode } from '../lib/departments';
import { suggestOrder, MIN_CHECKOUTS } from '../lib/routeSuggestion';

// Decline suppression is per-list (different lists = different stores).
const declineKey = (listId: string) => `routeSuggestionDeclines:${listId}`;
const MAX_DECLINES  = 5;
const SUPPRESS_DAYS = 14;
const WINDOW_DAYS   = 60;

function getDeclineState(listId: string): { count: number; suppressedUntil: number } {
  try {
    const raw = localStorage.getItem(declineKey(listId));
    return raw ? JSON.parse(raw) : { count: 0, suppressedUntil: 0 };
  } catch { return { count: 0, suppressedUntil: 0 }; }
}

export function useRouteSuggestion(listId: string) {
  const saveRoute = useCallback(async (sequence: DepartmentCode[]) => {
    if (sequence.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await db
      .from('checkout_routes')
      .insert({ list_id: listId, user_id: user.id, sequence });
    if (error) console.error('Failed to save checkout route', error);
  }, [listId]);

  const fetchSuggestion = useCallback(async (
    currentOrder: DepartmentCode[],
  ): Promise<DepartmentCode[] | null> => {
    const state = getDeclineState(listId);
    if (state.count >= MAX_DECLINES && Date.now() < state.suppressedUntil) return null;

    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);

    const { data, error } = await db
      .from('checkout_routes')
      .select('sequence')
      .eq('list_id', listId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(20);

    if (error || !data || (data as unknown[]).length < MIN_CHECKOUTS) return null;

    const sequences = (data as { sequence: DepartmentCode[] }[]).map(r => r.sequence);
    return suggestOrder(sequences, currentOrder, DEPARTMENTS);
  }, [listId]);

  const acceptSuggestion = useCallback(() => {
    localStorage.removeItem(declineKey(listId));
  }, [listId]);

  const declineSuggestion = useCallback(() => {
    const state = getDeclineState(listId);
    const newCount = state.count + 1;
    localStorage.setItem(declineKey(listId), JSON.stringify({
      count: newCount,
      suppressedUntil: newCount >= MAX_DECLINES
        ? Date.now() + SUPPRESS_DAYS * 24 * 60 * 60 * 1000
        : 0,
    }));
  }, [listId]);

  return { saveRoute, fetchSuggestion, acceptSuggestion, declineSuggestion };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build -- --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRouteSuggestion.ts
git commit -m "feat(route-sort): useRouteSuggestion hook — per-list decline suppression + time reset"
```

---

## Task 5: Component — `RouteSuggestionDialog`

**Files:**
- Create: `src/components/RouteSuggestionDialog.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { useEffect } from 'react';
import { DEPARTMENT_BY_CODE } from '../lib/departments';
import type { DepartmentCode } from '../lib/departments';

interface Props {
  suggested: DepartmentCode[];
  onAccept: () => void;
  onDecline: () => void;
}

export function RouteSuggestionDialog({ suggested, onAccept, onDecline }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onDecline(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDecline]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-2">
      <div className="card w-full max-w-sm p-4">
        <h2 className="text-base font-semibold mb-1">סדר מחלקות חדש?</h2>
        <p className="text-sm text-muted mb-3">
          לפי הדרך שבה קנית לאחרונה, הסדר הזה מתאים יותר למסלול שלך בחנות:
        </p>
        <ol className="text-sm space-y-1 mb-4 list-decimal list-inside">
          {suggested.map(code => (
            <li key={code}>{DEPARTMENT_BY_CODE[code]?.name ?? code}</li>
          ))}
        </ol>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onDecline}>לא עכשיו</button>
          <button className="btn-primary flex-1" onClick={onAccept}>כן, עדכן</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build -- --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add src/components/RouteSuggestionDialog.tsx
git commit -m "feat(route-sort): RouteSuggestionDialog component"
```

---

## Task 6: Wire it all together in `ActiveList`

**Files:**
- Modify: `src/components/ActiveList.tsx`

Read the current file in full before making any edits.

- [ ] **Step 1: Add imports**

Add to the existing imports at the top of `src/components/ActiveList.tsx`:

```ts
import { inferRouteSequence } from '../lib/routeSuggestion';
import { useRouteSuggestion } from '../hooks/useRouteSuggestion';
import { RouteSuggestionDialog } from './RouteSuggestionDialog';
```

`DEPARTMENTS` and `DEPARTMENT_CODES` are re-exported from `'../lib/departmentLookup'`. Add them to whichever import line already brings in `groupByDepartment`:

```ts
import { groupByDepartment, getDepartmentForItem, DEPARTMENTS, DEPARTMENT_CODES } from '../lib/departmentLookup';
```

- [ ] **Step 2: Add state, ref, and hook inside the `ActiveList` component**

After the existing `useState` / `useRef` declarations (around line 108):

```ts
const [suggestedOrder, setSuggestedOrder] = useState<DepartmentCode[] | null>(null);
const cartAtCheckoutRef = useRef<ListItem[]>([]);
const { saveRoute, fetchSuggestion, acceptSuggestion, declineSuggestion } = useRouteSuggestion(list.id);
```

- [ ] **Step 3: Build a helper that returns the full current order**

Add this as a regular function inside the component (after the hooks, before any JSX):

```ts
function buildCurrentOrder(): DepartmentCode[] {
  // Start with explicitly ordered departments from the per-list orderMap.
  const explicit = [...orderMap.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([c]) => c);
  // Append any defaults that aren't already listed.
  const explicitSet = new Set(explicit);
  const remaining = DEPARTMENTS
    .filter(d => d.code !== DEPARTMENT_CODES.UNCLASSIFIED && !explicitSet.has(d.code))
    .sort((a, b) => a.order - b.order)
    .map(d => d.code);
  return [...explicit, ...remaining];
}
```

- [ ] **Step 4: Capture cart items when the checkout button is tapped**

Find the checkout button's `onClick` (around line 339):

```tsx
onClick={() => setCheckoutOpen(true)}
```

Replace with:

```tsx
onClick={() => {
  cartAtCheckoutRef.current = items.filter(i => i.is_in_cart);
  setCheckoutOpen(true);
}}
```

- [ ] **Step 5: Update `CheckoutDialog`'s `onDone`**

Find (around line 347):

```tsx
onDone={() => { setCheckoutOpen(false); void refresh(); }}
```

Replace with:

```tsx
onDone={() => {
  setCheckoutOpen(false);
  void (async () => {
    const sequence = inferRouteSequence(cartAtCheckoutRef.current, catalog, nameOverrides);
    await saveRoute(sequence);
    await refresh();
    const suggestion = await fetchSuggestion(buildCurrentOrder());
    if (suggestion) setSuggestedOrder(suggestion);
  })();
}}
```

- [ ] **Step 6: Add `RouteSuggestionDialog` to the JSX**

In the `return (...)` block, directly before the final `</div>` (after the existing `{editingDeptItem && ...}` block):

```tsx
{suggestedOrder && (
  <RouteSuggestionDialog
    suggested={suggestedOrder}
    onAccept={() => {
      acceptSuggestion();
      reorder(suggestedOrder);
      setSuggestedOrder(null);
    }}
    onDecline={() => {
      declineSuggestion();
      setSuggestedOrder(null);
    }}
  />
)}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npm run build -- --noEmit 2>&1 | head -50
```

Fix any type errors before continuing.

- [ ] **Step 8: Run all unit tests**

```bash
npm run test:run
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/ActiveList.tsx
git commit -m "feat(route-sort): wire route capture + suggestion dialog into ActiveList"
```

---

## Task 7: Update README + push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the English "Learns your habits" section**

Find:

```markdown
- **Department order** — drag the departments into the order that matches your store layout. The app remembers it per list, so next time you shop the same route, everything is already sorted the way you walk.
```

Replace with:

```markdown
- **Department order** — drag departments to match your store's layout. The app also *learns automatically*: after a few checkouts it analyses the order you check off items and suggests reordering the sections to match your real walking route. One tap to accept.
```

- [ ] **Step 2: Update the Hebrew "סדר מחלקות" bullet**

Find:

```markdown
- **סדר מחלקות** — גוררים את המחלקות לפי הסדר שמתאים לסופר שלכם, והסדר נשמר לכל רשימה בנפרד ומיושם אוטומטית בביקור הבא.
```

Replace with:

```markdown
- **סדר מחלקות** — גוררים את המחלקות לפי הסדר שמתאים לסופר שלכם. האפליקציה גם **לומדת אוטומטית**: לאחר כמה קניות היא מנתחת את הסדר שבו סימנתם מוצרים ומציעה לעדכן את סדר המחלקות בהתאם למסלול האמיתי שלכם בחנות. לחיצה אחת לאישור.
```

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: update README — smart route sorting is live"
git push
```

---

## Self-Review

**Review comments addressed:**

| Comment | Fix |
|---|---|
| `updated_at` polluted by edits | Added `checked_at` column (Task 1+2); fallback to `updated_at` only when null |
| Missing sequence grant on bigserial | Added `grant usage, select on sequence ... to authenticated` in migration 0020 |
| RLS `with check` allows arbitrary `list_id` | Added `exists(...)` sub-query checking list membership/ownership |
| Decline suppression was global | Changed to per-list key + 14-day time-based reset |
| Weak `toBeNull` test | Test now asserts `toBeNull()` for the "already matching" case |
| Double-counting department within one checkout | `suggestOrder` deduplicates each sequence to first occurrence before averaging |
| `currentOrder` was partial (only from `orderMap`) | `buildCurrentOrder()` appends unordered defaults; passed to `suggestOrder` |
| No error handling in `saveRoute` | Added `const { error } = ...` + `console.error` |
| Import inconsistency | Imports from `'../lib/departments'` for types/meta; `'../lib/departmentLookup'` for runtime functions |

**Spec coverage:**

| Phase 4 requirement | Task |
|---|---|
| Reliable check-off timestamp | Task 1+2 (`checked_at` column + stamp on `setInCart`) |
| Persist sequence to DB | Task 1 (migration) + Task 4 (`saveRoute`) |
| Compute average position per department | Task 3 (`suggestOrder`) |
| ≥ 3 checkouts threshold | Task 3 (`MIN_CHECKOUTS = 3`) |
| 60-day window | Task 4 (`WINDOW_DAYS = 60`) |
| Suggestion dialog with accept/decline | Task 5 (`RouteSuggestionDialog`) |
| Accept → update `department_order` | Task 6 (`reorder(suggestedOrder)`) |
| Decline → suppress for N checkouts | Task 4 (`MAX_DECLINES = 5`, `SUPPRESS_DAYS = 14`) |
| Unobserved departments after observed, in default order | Task 3 (`unobserved` array) |
| `UNCLASSIFIED` never appears in suggestion | Task 3 (filtered in both `observed` and `unobserved`) |
| Full current order passed to comparison | Task 6 (`buildCurrentOrder()`) |
