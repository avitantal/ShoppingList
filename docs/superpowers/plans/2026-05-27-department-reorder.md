# Department Drag-and-Drop Reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long-press on a department header drags it to a new position; the custom order is saved per-list in Supabase and persists across sessions.

**Architecture:** A new `useDepartmentOrder` hook holds the ordered array in local state (optimistic) and writes it to a new `shopping_lists.department_order` jsonb column. `ActiveList` wraps its department groups in a `@dnd-kit` `DndContext` + `SortableContext`; `DepartmentHeader` receives `dragHandleProps` spread from `useSortable`, and a `DepartmentHeaderDragOverlay` floats as the drag preview.

**Tech Stack:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (already installed), Supabase `db.from().update()`, Vitest + React Testing Library.

---

## File Map

| Action | File |
|---|---|
| Create | `supabase/migrations/0015_department_order_per_list.sql` |
| Modify | `src/lib/supabase.ts` — add `department_order` to `ShoppingList` |
| Create | `src/hooks/useDepartmentOrder.ts` |
| Create | `src/test/hooks/useDepartmentOrder.test.ts` |
| Modify | `src/components/DepartmentHeader.tsx` — add `dragHandleProps` prop |
| Create | `src/test/components/DepartmentHeader.test.tsx` |
| Create | `src/components/DepartmentHeaderDragOverlay.tsx` |
| Modify | `src/components/ActiveList.tsx` — `{ list }` prop, DnD context, `SortableDepartmentGroup` |
| Modify | `src/components/AppShell.tsx` — pass `list` instead of `listId` |
| Modify | `src/test/hooks/useLists.test.ts` — add `department_order: null` to fixtures |
| Modify | `package.json` — version bump |

---

## Task 1: DB migration + TypeScript type

**Files:**
- Create: `supabase/migrations/0015_department_order_per_list.sql`
- Modify: `src/lib/supabase.ts`
- Modify: `src/test/hooks/useLists.test.ts`

- [ ] **Step 1.1: Write migration file**

```sql
-- supabase/migrations/0015_department_order_per_list.sql
alter table shopping.shopping_lists
  add column department_order jsonb;
```

- [ ] **Step 1.2: Apply migration via Supabase MCP**

Use `mcp__supabase-a__apply_migration` (or whichever Supabase MCP instance is active) with:
- `name`: `0015_department_order_per_list`
- `query`: contents of the file above

Confirm no error in the response.

- [ ] **Step 1.3: Update ShoppingList interface**

In `src/lib/supabase.ts`, add the import at the top and the new field:

```ts
// add at top, after the createClient import
import type { DepartmentCode } from './departments';
```

```ts
// in ShoppingList interface — add after updated_at:
department_order: DepartmentCode[] | null;
```

Result:
```ts
export interface ShoppingList {
  id: string;
  owner_id: string;
  name: string;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  department_order: DepartmentCode[] | null;
}
```

- [ ] **Step 1.4: Update test fixtures to include the new field**

In `src/test/hooks/useLists.test.ts`, add `department_order: null` to every list fixture object:

```ts
shopping_lists: [
  { id: 'L1', owner_id: 'u1', name: 'הרשימה שלי', is_default: true,  archived_at: null, created_at: 't', updated_at: 't', department_order: null },
  { id: 'L2', owner_id: 'u1', name: 'שבועי',     is_default: false, archived_at: null, created_at: 't', updated_at: 't', department_order: null },
  { id: 'L3', owner_id: 'u2', name: 'משפחתי',    is_default: false, archived_at: null, created_at: 't', updated_at: 't', department_order: null },
],
```

- [ ] **Step 1.5: Run tests to confirm no regressions**

```bash
npx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add supabase/migrations/0015_department_order_per_list.sql src/lib/supabase.ts src/test/hooks/useLists.test.ts
git commit -m "feat(db): add department_order jsonb column to shopping_lists"
```

---

## Task 2: `useDepartmentOrder` hook (TDD)

**Files:**
- Create: `src/test/hooks/useDepartmentOrder.test.ts`
- Create: `src/hooks/useDepartmentOrder.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `src/test/hooks/useDepartmentOrder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('../../lib/supabase', () => {
  const mock = makeMockClient({ shopping_lists: [] });
  return { supabase: mock, db: mock.schema('shopping'), SHOPPING_SCHEMA: 'shopping' };
});

beforeEach(() => vi.clearAllMocks());

describe('useDepartmentOrder', () => {
  it('returns empty orderMap when initialOrder is null', async () => {
    const { useDepartmentOrder } = await import('../../hooks/useDepartmentOrder');
    const { result } = renderHook(() => useDepartmentOrder('L1', null));
    expect(result.current.orderMap.size).toBe(0);
  });

  it('builds orderMap from initial order array', async () => {
    const { useDepartmentOrder } = await import('../../hooks/useDepartmentOrder');
    const { result } = renderHook(() =>
      useDepartmentOrder('L1', ['dairy', 'produce', 'bakery'] as any),
    );
    expect(result.current.orderMap.get('dairy')).toBe(0);
    expect(result.current.orderMap.get('produce')).toBe(1);
    expect(result.current.orderMap.get('bakery')).toBe(2);
  });

  it('reorder updates orderMap immediately (optimistic)', async () => {
    const { useDepartmentOrder } = await import('../../hooks/useDepartmentOrder');
    const { result } = renderHook(() =>
      useDepartmentOrder('L1', ['dairy', 'produce'] as any),
    );
    act(() => {
      result.current.reorder(['produce', 'dairy'] as any);
    });
    expect(result.current.orderMap.get('produce')).toBe(0);
    expect(result.current.orderMap.get('dairy')).toBe(1);
  });
});
```

- [ ] **Step 2.2: Run to verify tests fail**

```bash
npx vitest run src/test/hooks/useDepartmentOrder.test.ts
```

Expected: FAIL — "Cannot find module '../../hooks/useDepartmentOrder'"

- [ ] **Step 2.3: Write the hook implementation**

Create `src/hooks/useDepartmentOrder.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { db } from '../lib/supabase';
import type { DepartmentCode } from '../lib/departments';

export function useDepartmentOrder(
  listId: string,
  initialOrder: DepartmentCode[] | null,
) {
  const [order, setOrder] = useState<DepartmentCode[] | null>(initialOrder);

  const orderMap = useMemo(
    () => new Map((order ?? []).map((code, i) => [code, i] as [DepartmentCode, number])),
    [order],
  );

  const reorder = useCallback(
    (newCodes: DepartmentCode[]) => {
      const prev = order;
      setOrder(newCodes);
      void db
        .from('shopping_lists')
        .update({ department_order: newCodes })
        .eq('id', listId)
        .then(({ error }: { error: Error | null }) => {
          if (error) {
            setOrder(prev);
            toast.error('שמירת הסדר נכשלה');
          }
        });
    },
    [listId, order],
  );

  return { orderMap, reorder };
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
npx vitest run src/test/hooks/useDepartmentOrder.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/hooks/useDepartmentOrder.ts src/test/hooks/useDepartmentOrder.test.ts
git commit -m "feat(hooks): useDepartmentOrder — optimistic per-list department order"
```

---

## Task 3: `DepartmentHeader` — add `dragHandleProps` (TDD)

**Files:**
- Create: `src/test/components/DepartmentHeader.test.tsx`
- Modify: `src/components/DepartmentHeader.tsx`

- [ ] **Step 3.1: Write the failing test**

Create `src/test/components/DepartmentHeader.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DepartmentHeader } from '../../components/DepartmentHeader';
import type { DepartmentMeta } from '../../lib/departments';

const dept: DepartmentMeta = { code: 'dairy', name: 'חלב וביצים', order: 3 };

describe('DepartmentHeader', () => {
  it('renders the department name', () => {
    render(
      <DepartmentHeader
        department={dept}
        items={[]}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('חלב וביצים')).toBeDefined();
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(
      <DepartmentHeader
        department={dept}
        items={[]}
        collapsed={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('spreads dragHandleProps onto the header button', () => {
    const onPointerDown = vi.fn();
    render(
      <DepartmentHeader
        department={dept}
        items={[]}
        collapsed={false}
        onToggle={vi.fn()}
        dragHandleProps={{ onPointerDown }}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('button'));
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3.2: Run to verify tests fail**

```bash
npx vitest run src/test/components/DepartmentHeader.test.tsx
```

Expected: "spreads dragHandleProps" FAIL (prop doesn't exist yet); the other two may pass.

- [ ] **Step 3.3: Update `DepartmentHeader`**

In `src/components/DepartmentHeader.tsx`, update the `Props` interface and the button element:

```tsx
interface Props {
  department: DepartmentMeta;
  items: ListItem[];
  collapsed: boolean;
  onToggle: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}

export function DepartmentHeader({ department, items, collapsed, onToggle, dragHandleProps }: Props) {
```

Then on the `<button>` element, spread `dragHandleProps` after the existing event handler so caller props don't shadow `onClick`:

```tsx
<button
  type="button"
  onClick={onToggle}
  {...(dragHandleProps ?? {})}
  className={cn(
    'w-full flex items-center gap-2 py-1.5 pe-3 ps-2 min-h-[36px] bg-surface border-b border-border border-s-2 text-xs font-semibold uppercase tracking-wider sticky top-0 z-10',
    allDone ? 'text-emerald-400/80 border-s-emerald-500/60' : 'text-muted border-s-accent/70',
  )}
  aria-expanded={!collapsed}
  aria-controls={`dept-${department.code}-items`}
>
```

> **Note:** Spreading `dragHandleProps` after `onClick` means dnd-kit's own listeners (onPointerDown etc.) are added without overriding the toggle. The `aria-*` attributes that follow are explicit, so they take precedence over any conflicting ARIA attrs from `dragHandleProps`.

- [ ] **Step 3.4: Run tests to verify all pass**

```bash
npx vitest run src/test/components/DepartmentHeader.test.tsx
```

Expected: 3 tests PASS.

- [ ] **Step 3.5: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add src/components/DepartmentHeader.tsx src/test/components/DepartmentHeader.test.tsx
git commit -m "feat(ui): DepartmentHeader accepts dragHandleProps for dnd-kit integration"
```

---

## Task 4: `DepartmentHeaderDragOverlay` component

**Files:**
- Create: `src/components/DepartmentHeaderDragOverlay.tsx`

- [ ] **Step 4.1: Create the component**

Create `src/components/DepartmentHeaderDragOverlay.tsx`:

```tsx
import { useMemo } from 'react';
import { GripVertical } from 'lucide-react';
import type { DepartmentMeta } from '../lib/departments';
import type { ListItem } from '../lib/supabase';
import { formatCompactILS } from '../lib/format';
import { cn } from '../lib/utils';

interface Props {
  department: DepartmentMeta;
  items: ListItem[];
}

export function DepartmentHeaderDragOverlay({ department, items }: Props) {
  const { remainingCount, total } = useMemo(() => {
    let rc = 0;
    let t = 0;
    for (const i of items) {
      if (!i.is_in_cart) rc++;
      if (!i.is_in_cart && i.estimated_price != null) t += i.estimated_price * i.qty;
    }
    return { remainingCount: rc, total: t };
  }, [items]);

  const allDone = remainingCount === 0;

  return (
    <div
      className={cn(
        'w-full flex items-center gap-2 py-1.5 pe-3 ps-2 min-h-[36px] bg-surface border-b border-border border-s-2 text-xs font-semibold uppercase tracking-wider',
        'shadow-2xl scale-[1.02] origin-top cursor-grabbing',
        allDone
          ? 'text-emerald-400/80 border-s-emerald-500/60'
          : 'text-muted border-s-accent/70',
      )}
    >
      <GripVertical size={16} className="shrink-0 text-accent" />
      <span className="flex-1 text-start truncate">{department.name}</span>
      <span className="text-xs font-normal text-muted tabular-nums">
        {remainingCount > 0 ? `${remainingCount}` : '✓'}
        {total > 0 ? ` · ${formatCompactILS(total)}` : ''}
      </span>
    </div>
  );
}
```

- [ ] **Step 4.2: Commit**

```bash
git add src/components/DepartmentHeaderDragOverlay.tsx
git commit -m "feat(ui): DepartmentHeaderDragOverlay — lifted header shown during drag"
```

---

## Task 5: `ActiveList` — DnD wiring + `SortableDepartmentGroup`

**Files:**
- Modify: `src/components/ActiveList.tsx`

This task replaces the `Fragment`-based group rendering with `SortableDepartmentGroup` and wraps the list in a `DndContext`.

- [ ] **Step 5.1: Update imports in `ActiveList.tsx`**

Replace the existing import block at the top of `src/components/ActiveList.tsx` with:

```tsx
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useListItems } from '../hooks/useListItems';
import { useProductDepartments } from '../hooks/useProductDepartments';
import { useDepartmentNameOverrides } from '../hooks/useDepartmentNameOverrides';
import { useDepartmentCollapse } from '../hooks/useDepartmentCollapse';
import { useDepartmentOrder } from '../hooks/useDepartmentOrder';
import { ItemRow } from './ItemRow';
import { AddItemInput } from './AddItemInput';
import { CartTotalFooter } from './CartTotalFooter';
import { CheckoutDialog } from './CheckoutDialog';
import { LinkItemDialog } from './LinkItemDialog';
import { DepartmentHeader } from './DepartmentHeader';
import { DepartmentHeaderDragOverlay } from './DepartmentHeaderDragOverlay';
import { ChangeDepartmentSheet } from './ChangeDepartmentSheet';
import { getProductLinkDefault, saveProductLinkDefault } from '../lib/productLinkDefaults';
import { groupByDepartment, getDepartmentForItem } from '../lib/departmentLookup';
import { db, type ListItem, type SearchProductResult, type ShoppingList } from '../lib/supabase';
import type { DepartmentCode } from '../lib/departments';
import type { DepartmentGroup } from '../lib/departmentLookup';
```

Remove the now-unused `Fragment` import if TypeScript warns — actually keep it, it's still used in the JSX.

- [ ] **Step 5.2: Change Props interface and function signature**

Replace:
```tsx
interface Props { listId: string; }

export function ActiveList({ listId }: Props) {
```

With:
```tsx
interface Props { list: ShoppingList; }

export function ActiveList({ list }: Props) {
```

Then replace every occurrence of `listId` in the function body with `list.id`. There are these occurrences:
- `useListItems(listId)` → `useListItems(list.id)`
- `autoLinkedListId.current === listId` → `=== list.id`
- `autoLinkedListId.current = listId` → `= list.id`
- `}, [listId, loading]);` → `}, [list.id, loading]);`
- `<CheckoutDialog listId={listId}` → `listId={list.id}`

- [ ] **Step 5.3: Add `useDepartmentOrder` hook and sensors config**

After the existing hook declarations (`useListItems`, `useProductDepartments`, etc.), add:

```tsx
const { orderMap, reorder } = useDepartmentOrder(list.id, list.department_order);

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { delay: 550, tolerance: 8 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);
const [draggingCode, setDraggingCode] = useState<string | null>(null);
```

- [ ] **Step 5.4: Update `groupByDepartment` call to pass `orderMap`**

Replace:
```tsx
const groups = useMemo(
  () => groupByDepartment(items, catalog, undefined, nameOverrides),
  [items, catalog, nameOverrides],
);
```

With:
```tsx
const groups = useMemo(
  () => groupByDepartment(items, catalog, orderMap, nameOverrides),
  [items, catalog, orderMap, nameOverrides],
);
```

- [ ] **Step 5.5: Add drag handlers**

After the existing `applyDepartmentOverride` function, add:

```tsx
function handleDragStart({ active }: DragStartEvent) {
  setDraggingCode(active.id as string);
}

function handleDragEnd({ active, over }: DragEndEvent) {
  setDraggingCode(null);
  if (!over || active.id === over.id) return;
  const codes = groups.map(g => g.department.code);
  const oldIndex = codes.indexOf(active.id as string);
  const newIndex = codes.indexOf(over.id as string);
  if (oldIndex === -1 || newIndex === -1) return;
  reorder(arrayMove(codes, oldIndex, newIndex));
}
```

- [ ] **Step 5.6: Add `SortableDepartmentGroup` component (above `ActiveList` export)**

Insert this component definition immediately before the `export function ActiveList` line:

```tsx
interface SortableGroupProps {
  group: DepartmentGroup;
  collapsed: boolean;
  onToggle: () => void;
  onSetInCart: (id: string, val: boolean) => void;
  onQtyChange: (id: string, qty: number) => void;
  onDelete: (item: ListItem) => void;
  onOpenLink: (item: ListItem) => void;
  onChangeDepartment: (item: ListItem) => void;
}

function SortableDepartmentGroup({
  group, collapsed, onToggle,
  onSetInCart, onQtyChange, onDelete, onOpenLink, onChangeDepartment,
}: SortableGroupProps) {
  const {
    setNodeRef, transform, transition, isDragging, attributes, listeners,
  } = useSortable({ id: group.department.code });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
      }}
    >
      <DepartmentHeader
        department={group.department}
        items={group.items}
        collapsed={collapsed}
        onToggle={onToggle}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
      <div
        className={`grid transition-[grid-template-rows] duration-200 ${
          collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
        }`}
        id={`dept-${group.department.code}-items`}
      >
        <div className="overflow-hidden">
          {group.items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              onToggle={(next) => onSetInCart(it.id, next)}
              onQtyChange={(next) => onQtyChange(it.id, next)}
              onDelete={() => onDelete(it)}
              onOpenLink={() => onOpenLink(it)}
              onChangeDepartment={() => onChangeDepartment(it)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.7: Replace the groups JSX inside the scroll container**

In the `return` statement of `ActiveList`, find the groups rendering section:

```tsx
{items.length === 0 ? (
  <div className="text-center text-muted p-8 text-sm">הרשימה ריקה — הוסף את הפריט הראשון</div>
) : (
  groups.map((g) => {
    const isCollapsed = collapsed.has(g.department.code);
    return (
      <Fragment key={g.department.code}>
        <DepartmentHeader
          department={g.department}
          items={g.items}
          collapsed={isCollapsed}
          onToggle={() => toggleCollapsed(g.department.code)}
        />
        <div
          className={`grid transition-[grid-template-rows] duration-200 ${isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
          id={`dept-${g.department.code}-items`}
        >
          <div className="overflow-hidden">
            {g.items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                onToggle={(next) => setInCart(it.id, next)}
                onQtyChange={(next) => updateItem(it.id, { qty: next })}
                onDelete={() => deleteWithUndo(it)}
                onOpenLink={() => openLink(it)}
                onChangeDepartment={() => setEditingDeptItemId(it.id)}
              />
            ))}
          </div>
        </div>
      </Fragment>
    );
  })
)}
```

Replace with:

```tsx
{items.length === 0 ? (
  <div className="text-center text-muted p-8 text-sm">הרשימה ריקה — הוסף את הפריט הראשון</div>
) : (
  <DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
  >
    <SortableContext
      items={groups.map(g => g.department.code)}
      strategy={verticalListSortingStrategy}
    >
      {groups.map((g) => (
        <SortableDepartmentGroup
          key={g.department.code}
          group={g}
          collapsed={collapsed.has(g.department.code)}
          onToggle={() => toggleCollapsed(g.department.code)}
          onSetInCart={(id, val) => setInCart(id, val)}
          onQtyChange={(id, qty) => updateItem(id, { qty })}
          onDelete={deleteWithUndo}
          onOpenLink={openLink}
          onChangeDepartment={(it) => setEditingDeptItemId(it.id)}
        />
      ))}
    </SortableContext>
    <DragOverlay>
      {draggingCode != null && (() => {
        const g = groups.find(gr => gr.department.code === draggingCode);
        return g ? (
          <DepartmentHeaderDragOverlay department={g.department} items={g.items} />
        ) : null;
      })()}
    </DragOverlay>
  </DndContext>
)}
```

- [ ] **Step 5.8: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. (There are no `ActiveList` unit tests that need updating — if TypeScript errors appear due to `Fragment` being unused, remove the `Fragment` import.)

- [ ] **Step 5.9: Commit**

```bash
git add src/components/ActiveList.tsx
git commit -m "feat(ui): wire dnd-kit drag-to-reorder onto department groups in ActiveList"
```

---

## Task 6: `AppShell` — pass `list` object + version bump

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `package.json`

- [ ] **Step 6.1: Update AppShell to pass `list` instead of `listId`**

In `src/components/AppShell.tsx`, find:

```tsx
<ActiveList listId={active.id} />
```

Replace with:

```tsx
<ActiveList list={active} />
```

No other changes needed — `active` is already typed as `ShoppingList` (derived from `useLists`), and now includes `department_order`.

- [ ] **Step 6.2: Bump version**

In `package.json`, change:
```json
"version": "0.23.0"
```
to:
```json
"version": "0.24.0"
```

In `src/components/AppShell.tsx`, the version label reads `v{__APP_VERSION__}` — this auto-updates from `package.json` via Vite, so no code change needed.

- [ ] **Step 6.3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6.4: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/AppShell.tsx package.json
git commit -m "feat(reorder): long-press department headers to drag-reorder per list — v0.24.0"
```

---

## Self-review notes

**Spec coverage:**
- ✅ Long-press activation (550ms via PointerSensor activationConstraint)
- ✅ Floating clone drag UX (DragOverlay with DepartmentHeaderDragOverlay)
- ✅ Order stored per-list in Supabase (department_order jsonb column)
- ✅ Optimistic update with rollback (useDepartmentOrder)
- ✅ New departments default to end of list (groupByDepartment fallback)
- ✅ Props threading: `list: ShoppingList` flows from AppShell → ActiveList → useDepartmentOrder

**Type consistency:**
- `useDepartmentOrder(listId: string, initialOrder: DepartmentCode[] | null)` — used as `useDepartmentOrder(list.id, list.department_order)` in Task 5 step 3 ✅
- `reorder(arrayMove(codes, oldIndex, newIndex))` — `arrayMove` returns `DepartmentCode[]` ✅
- `dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>` — `{ ...attributes, ...listeners }` from dnd-kit spreads fine ✅
- `DepartmentHeaderDragOverlay` props match its definition ✅
