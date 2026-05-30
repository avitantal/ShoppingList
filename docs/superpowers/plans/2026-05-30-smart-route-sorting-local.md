# Smart Route Sorting — Local-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track the order in which items are checked off during shopping, infer a per-list department visit sequence, and after 3+ checkouts suggest reordering department sections to match the user's real walking route — using only localStorage, no DB changes.

**Architecture:** A ref in `ActiveList` accumulates department codes as items are checked off. On checkout completion the sequence is cleaned (`extractRoute`: collapse consecutive dupes, deduplicate by first occurrence) and appended to a per-list localStorage array. `suggestOrder` uses **pairwise rank aggregation** (Copeland score): for every pair of departments, it counts how often A appeared before B across all checkouts. Decisive pairs (≥3 observations, ≥67% win rate) that disagree with the current order trigger a suggestion. Decline suppression is also localStorage-only.

**Tech Stack:** React 19, TypeScript, Vitest (jsdom)

---

## What was deliberately cut vs. the DB approach

| Removed | Reason |
|---|---|
| Migration 0019 — `checked_at` column | Sequence tracked in-memory; no timestamp needed |
| Migration 0020 — `checkout_routes` table | localStorage replaces DB |
| RLS policies | No DB table |
| `supabase.auth.getUser()` | No insert needed |
| `useRouteSuggestion` hook | Direct function calls instead |

**Trade-off accepted:** sequences are per-device. If the user shops across devices, each learns independently. For a personal walking-route feature this is fine.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/lib/routeSuggestion.ts` | **Create** | `extractRoute`, `appendRoute`, `getStoredRoutes`, `suggestOrder` (pairwise/Copeland), `isSuggestionSuppressed`, `recordDecline`, `resetDecline` |
| `src/test/lib/routeSuggestion.test.ts` | **Create** | Unit tests for all exported functions |
| `src/components/RouteSuggestionDialog.tsx` | **Create** | Accept/decline dialog |
| `src/components/ActiveList.tsx` | **Modify** | Track check-off sequence, wire checkout → append → suggest → dialog |
| `README.md` | **Modify** | Update "Learns your habits" section |

---

## Task 1: routeSuggestion.ts — pure functions + localStorage helpers

**Files:**
- Create: `src/lib/routeSuggestion.ts`
- Create: `src/test/lib/routeSuggestion.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/routeSuggestion.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractRoute,
  appendRoute,
  getStoredRoutes,
  suggestOrder,
  isSuggestionSuppressed,
  recordDecline,
  resetDecline,
  MIN_CHECKOUTS,
} from '../../lib/routeSuggestion';
import { DEPARTMENTS } from '../../lib/departments';
import type { DepartmentCode } from '../../lib/departments';

beforeEach(() => { localStorage.clear(); });

const fullOrder = DEPARTMENTS
  .filter(d => d.code !== 'unclassified')
  .sort((a, b) => a.order - b.order)
  .map(d => d.code) as DepartmentCode[];

describe('extractRoute', () => {
  it('collapses consecutive duplicates and deduplicates by first occurrence (default minCluster=1)', () => {
    // snacks kept — noise filtering is handled by pairwise confidence, not early rejection
    const raw = ['dairy', 'dairy', 'snacks', 'dairy', 'dairy', 'bakery', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw)).toEqual(['dairy', 'snacks', 'bakery']);
  });
  it('deduplicates revisited sections by first occurrence', () => {
    const raw = ['dairy', 'dairy', 'bakery', 'bakery', 'dairy', 'dairy'] as DepartmentCode[];
    expect(extractRoute(raw)).toEqual(['dairy', 'bakery']);
  });
  it('returns empty for empty input', () => {
    expect(extractRoute([])).toEqual([]);
  });
  it('keeps single-item departments with default minCluster=1', () => {
    // single bread → bakery still makes it into the route (important for small purchases)
    const raw = ['dairy', 'snacks', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw)).toEqual(['dairy', 'snacks', 'bakery']);
  });
  it('filters singleton runs with explicit minCluster=2', () => {
    const raw = ['dairy', 'dairy', 'snacks', 'dairy', 'dairy', 'bakery', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw, 2)).toEqual(['dairy', 'bakery']);
  });
  it('returns empty when all runs are singletons with minCluster=2', () => {
    const raw = ['dairy', 'snacks', 'bakery'] as DepartmentCode[];
    expect(extractRoute(raw, 2)).toEqual([]);
  });
});

describe('appendRoute / getStoredRoutes', () => {
  it('stores and retrieves sequences', () => {
    appendRoute('list-1', ['dairy', 'bakery'] as DepartmentCode[]);
    expect(getStoredRoutes('list-1')).toEqual([['dairy', 'bakery']]);
  });
  it('does not store empty sequences', () => {
    appendRoute('list-1', []);
    expect(getStoredRoutes('list-1')).toEqual([]);
  });
  it('caps at 20 stored sequences', () => {
    for (let i = 0; i < 25; i++) appendRoute('list-1', ['dairy'] as DepartmentCode[]);
    expect(getStoredRoutes('list-1')).toHaveLength(20);
  });
  it('isolates between lists', () => {
    appendRoute('list-1', ['dairy'] as DepartmentCode[]);
    expect(getStoredRoutes('list-2')).toEqual([]);
  });
});

describe('suggestOrder', () => {
  it('returns null when fewer than MIN_CHECKOUTS usable sequences', () => {
    const seqs = [['dairy', 'produce']] as DepartmentCode[][];
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });

  it('returns null when all decisive pairs agree with current order', () => {
    // repeat the first 3 departments of fullOrder in their existing order
    const topThree = fullOrder.slice(0, 3);
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(topThree);
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });

  it('returns null when pairs lack enough observations (below MIN_PAIR_SUPPORT)', () => {
    // only 2 sequences → each pair seen 2 times < MIN_PAIR_SUPPORT=3 → no decisive pairs
    const seqs: DepartmentCode[][] = [
      ['beverages', 'produce', 'dairy'] as DepartmentCode[],
      ['beverages', 'produce', 'dairy'] as DepartmentCode[],
    ];
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });

  it('ranks beverages higher when user always starts there', () => {
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['beverages', 'produce', 'dairy'] as DepartmentCode[],
    );
    const result = suggestOrder(seqs, fullOrder, DEPARTMENTS);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.indexOf('beverages')).toBeLessThan(fullOrder.indexOf('beverages'));
    }
  });

  it('ranks dairy before bakery when dairy consistently comes first', () => {
    const seqs: DepartmentCode[][] = Array(MIN_CHECKOUTS).fill(
      ['dairy', 'bakery'] as DepartmentCode[],
    );
    const result = suggestOrder(seqs, fullOrder, DEPARTMENTS);
    if (result) {
      expect(result.indexOf('dairy')).toBeLessThan(result.indexOf('bakery'));
    }
  });

  it('does not count sequences that are only UNCLASSIFIED', () => {
    const seqs: DepartmentCode[][] = [
      ...Array(MIN_CHECKOUTS - 1).fill(['beverages', 'produce'] as DepartmentCode[]),
      ['unclassified'] as DepartmentCode[],
    ];
    expect(suggestOrder(seqs, fullOrder, DEPARTMENTS)).toBeNull();
  });
});

describe('decline suppression', () => {
  it('is not suppressed initially', () => {
    expect(isSuggestionSuppressed('list-1')).toBe(false);
  });

  it('is suppressed after 5 declines', () => {
    for (let i = 0; i < 5; i++) recordDecline('list-1');
    expect(isSuggestionSuppressed('list-1')).toBe(true);
  });

  it('resets after resetDecline', () => {
    for (let i = 0; i < 5; i++) recordDecline('list-1');
    resetDecline('list-1');
    expect(isSuggestionSuppressed('list-1')).toBe(false);
  });

  it('isolates between lists', () => {
    for (let i = 0; i < 5; i++) recordDecline('list-1');
    expect(isSuggestionSuppressed('list-2')).toBe(false);
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
import {
  DEPARTMENTS, DEPARTMENT_CODES,
  type DepartmentCode, type DepartmentMeta,
} from './departments';

export const MIN_CHECKOUTS      = 3;    // minimum usable checkout sequences before suggesting
const MAX_STORED              = 20;
const MAX_DECLINES            = 5;
const SUPPRESS_MS             = 14 * 24 * 60 * 60 * 1000;
const MIN_PAIR_SUPPORT        = 3;    // pair must have been observed at least this many times
const MIN_PAIR_CONFIDENCE     = 0.67; // win rate needed to count a pair as "decisive"
const MIN_CHANGED_PAIRS       = 2;    // decisive pairs that disagree with current order → show dialog

const ROUTE_KEY   = (listId: string) => `routeHistory:${listId}`;
const DECLINE_KEY = (listId: string) => `routeDeclines:${listId}`;

// ── Sequence ─────────────────────────────────────────────────────────────────

/**
 * Extract a clean route from a raw check-off sequence.
 * Groups into consecutive runs, collapses runs shorter than minCluster,
 * then deduplicates by first occurrence so revisiting a section doesn't shift it.
 *
 * Default minCluster=1: keep all departments including single-item ones.
 * Noise from one-off items is handled by pairwise confidence, not early rejection.
 * Pass minCluster=2 to aggressively filter pass-through singletons.
 */
export function extractRoute(raw: DepartmentCode[], minCluster = 1): DepartmentCode[] {
  const runs: { code: DepartmentCode; count: number }[] = [];
  for (const code of raw) {
    const last = runs.at(-1);
    if (last?.code === code) last.count++;
    else runs.push({ code, count: 1 });
  }
  return runs
    .filter(r => r.count >= minCluster)
    .map(r => r.code)
    .filter((c, i, arr) => arr.indexOf(c) === i);
}

// ── localStorage ─────────────────────────────────────────────────────────────

export function getStoredRoutes(listId: string): DepartmentCode[][] {
  try {
    const raw = localStorage.getItem(ROUTE_KEY(listId));
    return raw ? (JSON.parse(raw) as DepartmentCode[][]) : [];
  } catch { return []; }
}

export function appendRoute(listId: string, sequence: DepartmentCode[]): void {
  if (sequence.length === 0) return;
  try {
    const stored = getStoredRoutes(listId);
    localStorage.setItem(
      ROUTE_KEY(listId),
      JSON.stringify([...stored, sequence].slice(-MAX_STORED)),
    );
  } catch {}
}

// ── Decline suppression ──────────────────────────────────────────────────────

interface DeclineState { count: number; suppressedUntil: number; }

function getDeclineState(listId: string): DeclineState {
  try {
    const raw = localStorage.getItem(DECLINE_KEY(listId));
    if (!raw) return { count: 0, suppressedUntil: 0 };
    const p = JSON.parse(raw);
    const count = Number.isFinite(p?.count) ? p.count : 0;
    const suppressedUntil = Number.isFinite(p?.suppressedUntil) ? p.suppressedUntil : 0;
    if (count >= MAX_DECLINES && suppressedUntil > 0 && Date.now() >= suppressedUntil) {
      localStorage.removeItem(DECLINE_KEY(listId));
      return { count: 0, suppressedUntil: 0 };
    }
    return { count, suppressedUntil };
  } catch { return { count: 0, suppressedUntil: 0 }; }
}

export function isSuggestionSuppressed(listId: string): boolean {
  const { count, suppressedUntil } = getDeclineState(listId);
  return count >= MAX_DECLINES && Date.now() < suppressedUntil;
}

export function recordDecline(listId: string): void {
  const { count } = getDeclineState(listId);
  const newCount = count + 1;
  localStorage.setItem(DECLINE_KEY(listId), JSON.stringify({
    count: newCount,
    suppressedUntil: newCount >= MAX_DECLINES ? Date.now() + SUPPRESS_MS : 0,
  }));
}

export function resetDecline(listId: string): void {
  localStorage.removeItem(DECLINE_KEY(listId));
}

// ── Suggestion algorithm (pairwise / Copeland) ───────────────────────────────

/** For each ordered pair (A, B) seen in the same sequence: how many times did A come before B? */
function buildPairStats(sequences: DepartmentCode[][]): Map<string, { aFirst: number; bFirst: number }> {
  const stats = new Map<string, { aFirst: number; bFirst: number }>();
  for (const seq of sequences) {
    const unique = seq.filter((c, i) => seq.indexOf(c) === i);
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const earlier = unique[i], later = unique[j];
        // Canonical key: alphabetically-earlier code first so each pair has one key.
        const [a, b] = earlier < later
          ? [earlier, later] as [DepartmentCode, DepartmentCode]
          : [later, earlier] as [DepartmentCode, DepartmentCode];
        const key = `${a}|${b}`;
        const cur = stats.get(key) ?? { aFirst: 0, bFirst: 0 };
        if (earlier === a) stats.set(key, { ...cur, aFirst: cur.aFirst + 1 });
        else               stats.set(key, { ...cur, bFirst: cur.bFirst + 1 });
      }
    }
  }
  return stats;
}

/** Copeland score: +1 for each decisive win, -1 for each decisive loss. */
function copelandScores(
  departments: DepartmentCode[],
  stats: Map<string, { aFirst: number; bFirst: number }>,
): Map<DepartmentCode, number> {
  const scores = new Map<DepartmentCode, number>(departments.map(d => [d, 0]));
  for (const [key, { aFirst, bFirst }] of stats) {
    const [a, b] = key.split('|') as [DepartmentCode, DepartmentCode];
    if (!scores.has(a) || !scores.has(b)) continue;
    const total = aFirst + bFirst;
    if (total < MIN_PAIR_SUPPORT) continue;
    const aRate = aFirst / total;
    if (aRate >= MIN_PAIR_CONFIDENCE) {
      scores.set(a, scores.get(a)! + 1);
      scores.set(b, scores.get(b)! - 1);
    } else if (aRate <= 1 - MIN_PAIR_CONFIDENCE) {
      scores.set(a, scores.get(a)! - 1);
      scores.set(b, scores.get(b)! + 1);
    }
  }
  return scores;
}

export function suggestOrder(
  sequences: DepartmentCode[][],
  currentOrder: DepartmentCode[],
  defaults: DepartmentMeta[] = DEPARTMENTS,
): DepartmentCode[] | null {
  // Strip UNCLASSIFIED and deduplicate each sequence; drop sequences that become empty.
  const usable = sequences
    .map(seq =>
      seq
        .filter(code => code !== DEPARTMENT_CODES.UNCLASSIFIED)
        .filter((code, i, arr) => arr.indexOf(code) === i)
    )
    .filter(seq => seq.length > 0);

  if (usable.length < MIN_CHECKOUTS) return null;

  const pairStats  = buildPairStats(usable);
  const observedSet = new Set(usable.flat());
  const observed   = [...observedSet];
  const scores     = copelandScores(observed, pairStats);

  // Sort observed departments by Copeland score; tiebreak by default order.
  const defaultIdx = new Map(defaults.map((d, i) => [d.code as DepartmentCode, i]));
  const sortedObserved = [...scores.keys()].sort((a, b) => {
    const scoreDiff = scores.get(b)! - scores.get(a)!;
    if (scoreDiff !== 0) return scoreDiff;
    return (defaultIdx.get(a) ?? 99) - (defaultIdx.get(b) ?? 99);
  });

  const unobserved = defaults
    .filter(d => d.code !== DEPARTMENT_CODES.UNCLASSIFIED && !observedSet.has(d.code as DepartmentCode))
    .sort((a, b) => a.order - b.order)
    .map(d => d.code as DepartmentCode);

  const suggested = [...sortedObserved, ...unobserved];

  // Count decisive pairs that disagree with the current order.
  const currentIdx = new Map<DepartmentCode, number>();
  defaults.forEach((d, i) => {
    const idx = currentOrder.indexOf(d.code as DepartmentCode);
    currentIdx.set(d.code as DepartmentCode, idx >= 0 ? idx : i);
  });

  let changedPairs = 0;
  for (const [key, { aFirst, bFirst }] of pairStats) {
    const total = aFirst + bFirst;
    if (total < MIN_PAIR_SUPPORT) continue;
    const aRate = aFirst / total;
    if (aRate < MIN_PAIR_CONFIDENCE && aRate > 1 - MIN_PAIR_CONFIDENCE) continue; // not decisive
    const [a, b]          = key.split('|') as [DepartmentCode, DepartmentCode];
    const decisiveFirst   = aRate >= MIN_PAIR_CONFIDENCE ? a : b;
    const curA = currentIdx.get(a) ?? 99;
    const curB = currentIdx.get(b) ?? 99;
    const currentFirst    = curA < curB ? a : b;
    if (decisiveFirst !== currentFirst) changedPairs++;
  }

  return changedPairs >= MIN_CHANGED_PAIRS ? suggested : null;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm run test:run -- src/test/lib/routeSuggestion.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routeSuggestion.ts src/test/lib/routeSuggestion.test.ts
git commit -m "feat(route-sort): routeSuggestion — pure functions + localStorage helpers"
```

---

## Task 2: RouteSuggestionDialog component

**Files:**
- Create: `src/components/RouteSuggestionDialog.tsx`

- [ ] **Step 1: Check whether `DEPARTMENT_BY_CODE` is exported from `src/lib/departments.ts`**

```bash
grep -n "DEPARTMENT_BY_CODE" src/lib/departments.ts
```

If it exists, use it directly. If it doesn't exist, build the map inline in the component:

```ts
const labelMap = Object.fromEntries(DEPARTMENTS.map(d => [d.code, d]));
// then use labelMap[code]?.name
```

- [ ] **Step 2: Implement the component**

```tsx
import { useEffect } from 'react';
import { DEPARTMENTS } from '../lib/departments';
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

  const labelMap = Object.fromEntries(DEPARTMENTS.map(d => [d.code, d]));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-2">
      <div className="card w-full max-w-sm p-4">
        <h2 className="text-base font-semibold mb-1">סדר מחלקות חדש?</h2>
        <p className="text-sm text-muted mb-3">
          לפי הדרך שבה קנית לאחרונה, הסדר הזה מתאים יותר למסלול שלך בחנות:
        </p>
        <ol className="text-sm space-y-1 mb-4 list-decimal list-inside">
          {suggested.map(code => (
            <li key={code}>{labelMap[code]?.name ?? code}</li>
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

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build -- --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/components/RouteSuggestionDialog.tsx
git commit -m "feat(route-sort): RouteSuggestionDialog component"
```

---

## Task 3: Wire into ActiveList

**Files:**
- Modify: `src/components/ActiveList.tsx`

Read the entire file before editing.

- [ ] **Step 1: Add imports**

Add at the top of `src/components/ActiveList.tsx`:

```ts
import {
  extractRoute, appendRoute, getStoredRoutes, suggestOrder,
  isSuggestionSuppressed, recordDecline, resetDecline,
} from '../lib/routeSuggestion';
import { RouteSuggestionDialog } from './RouteSuggestionDialog';
```

`DEPARTMENTS`, `DEPARTMENT_CODES`, and `DepartmentCode` must come from `'../lib/departments'` (not from `'../lib/departmentLookup'`). Check whether they're already imported there; if not, add:

```ts
import { DEPARTMENTS, DEPARTMENT_CODES } from '../lib/departments';
import type { DepartmentCode } from '../lib/departments';
```

- [ ] **Step 2: Add state and ref**

After the existing `useState` / `useRef` declarations:

```ts
const [suggestedOrder, setSuggestedOrder] = useState<DepartmentCode[] | null>(null);
const checkedDeptRef = useRef<DepartmentCode[]>([]);
```

- [ ] **Step 3: Add `handleToggle`**

Add this function inside the component (after hooks, before JSX). It intercepts item toggles to record the department sequence as items are checked off.

```ts
function handleToggle(item: ListItem, inCart: boolean) {
  if (inCart) {
    checkedDeptRef.current.push(getDepartmentForItem(item, catalog, nameOverrides));
  }
  void setInCart(item.id, inCart);
}
```

Find where `ItemRow` receives `onToggle` — it should look like:

```tsx
onToggle={(next) => void setInCart(item.id, next)}
```

Replace with:

```tsx
onToggle={(next) => handleToggle(item, next)}
```

- [ ] **Step 4: Add `buildCurrentOrder`**

```ts
function buildCurrentOrder(): DepartmentCode[] {
  const explicit = [...orderMap.entries()]
    .filter(([c]) => c !== DEPARTMENT_CODES.UNCLASSIFIED)
    .sort((a, b) => a[1] - b[1])
    .map(([c]) => c);
  const explicitSet = new Set(explicit);
  const remaining = DEPARTMENTS
    .filter(d => d.code !== DEPARTMENT_CODES.UNCLASSIFIED && !explicitSet.has(d.code as DepartmentCode))
    .sort((a, b) => a.order - b.order)
    .map(d => d.code as DepartmentCode);
  return [...explicit, ...remaining];
}
```

- [ ] **Step 5: Update `CheckoutDialog`'s `onDone`**

Find:

```tsx
onDone={() => { setCheckoutOpen(false); void refresh(); }}
```

Replace with:

```tsx
onDone={() => {
  setCheckoutOpen(false);
  const sequence = extractRoute(checkedDeptRef.current);
  checkedDeptRef.current = [];
  appendRoute(list.id, sequence);
  void refresh();
  if (!isSuggestionSuppressed(list.id)) {
    const suggestion = suggestOrder(getStoredRoutes(list.id), buildCurrentOrder(), DEPARTMENTS);
    if (suggestion) setSuggestedOrder(suggestion);
  }
}}
```

- [ ] **Step 6: Add `RouteSuggestionDialog` to JSX**

Before the final closing `</div>` (after the `{editingDeptItem && ...}` block):

```tsx
{suggestedOrder && (
  <RouteSuggestionDialog
    suggested={suggestedOrder}
    onAccept={() => {
      resetDecline(list.id);
      void reorder(suggestedOrder);
      setSuggestedOrder(null);
    }}
    onDecline={() => {
      recordDecline(list.id);
      setSuggestedOrder(null);
    }}
  />
)}
```

- [ ] **Step 7: TypeScript + full test suite**

```bash
npm run build -- --noEmit 2>&1 | head -50
npm run test:run
```

Fix any errors before committing.

- [ ] **Step 8: Commit**

```bash
git add src/components/ActiveList.tsx
git commit -m "feat(route-sort): wire route tracking + suggestion dialog into ActiveList"
```

---

## Task 4: README + version bump

**Files:**
- Modify: `README.md`
- Modify: `package.json` (version bump)
- Modify: wherever the in-app version label is displayed

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "0.25.1"` → `"version": "0.26.0"` (minor bump — new user-facing feature).

Find the version label in the UI (search for `0.25` in `src/`) and update it to match.

- [ ] **Step 2: Update English README**

Find:

```markdown
- **Department order** — drag the departments into the order that matches your store layout. The app remembers it per list, so next time you shop the same route, everything is already sorted the way you walk.
```

Replace with:

```markdown
- **Department order** — drag departments to match your store's layout. The app also *learns automatically*: after a few checkouts it analyses the order you check off items and suggests reordering the sections to match your real walking route. One tap to accept.
```

- [ ] **Step 3: Update Hebrew README**

Find:

```markdown
- **סדר מחלקות** — גוררים את המחלקות לפי הסדר שמתאים לסופר שלכם, והסדר נשמר לכל רשימה בנפרד ומיושם אוטומטית בביקור הבא.
```

Replace with:

```markdown
- **סדר מחלקות** — גוררים את המחלקות לפי הסדר שמתאים לסופר שלכם. האפליקציה גם **לומדת אוטומטית**: לאחר כמה קניות היא מנתחת את הסדר שבו סימנתם מוצרים ומציעה לעדכן את סדר המחלקות בהתאם למסלול האמיתי שלכם בחנות. לחיצה אחת לאישור.
```

- [ ] **Step 4: Commit**

```bash
git add README.md package.json src/...
git commit -m "feat(route-sort): bump v0.26.0 + update README"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Track visit order per checkout | Task 3 — `checkedDeptRef` + `handleToggle` |
| Pass-through noise filtered by confidence | Task 1 — `MIN_PAIR_SUPPORT=3`, `MIN_PAIR_CONFIDENCE=0.67`; inconsistent pairs don't become decisive |
| Single-item departments not lost | Task 1 — `extractRoute` default `minCluster=1`; bakery with one bread still enters pairwise stats |
| Persist sequences locally | Task 1 — `appendRoute` (localStorage) |
| ≥ 3 checkouts threshold | Task 1 — `MIN_CHECKOUTS = 3` in `suggestOrder` |
| Suggestion dialog with accept/decline | Task 2 — `RouteSuggestionDialog` |
| Accept → update `department_order` | Task 3 — `void reorder(suggestedOrder)` |
| Decline suppression (5× / 14 days, per list) | Task 1 — `recordDecline`, `isSuggestionSuppressed` |
| Suppress window auto-resets after 14 days | Task 1 — `getDeclineState` resets when `Date.now() >= suppressedUntil` |
| UNCLASSIFIED never appears in suggestion | Task 1 — filtered in `usable` pre-processing |
| Sequences that are only UNCLASSIFIED don't count | Task 1 — `usable` filtered to `seq.length > 0` after strip |
| Full current order passed to comparison | Task 3 — `buildCurrentOrder()` appends defaults after explicit |
| No DB required | ✅ entirely localStorage + in-memory |
