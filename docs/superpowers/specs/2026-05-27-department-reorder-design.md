# Design — Department Drag-and-Drop Reorder

**Date:** 2026-05-27
**Author:** Claude + Avita (brainstorming session)
**Status:** Approved — ready for implementation plan

---

## 1. Goal

Allow users to manually reorder department sections in a shopping list by long-pressing a department header and dragging it to a new position. The custom order is saved per-list in Supabase and persists across sessions.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Order scope | Per-list | Different lists may represent different stores |
| Storage | Supabase (`department_order` column on `shopping_lists`) | Persists across devices, syncs for shared lists |
| Drag library | `@dnd-kit/core` + `@dnd-kit/sortable` | Handles touch/mouse edge cases, accessibility, animations |
| Drag activation | Long-press (550ms, 8px tolerance) | Consistent with existing app UX pattern |
| Drag UX | Floating clone (DragOverlay) + ghost original | Option A selected in brainstorm |

---

## 3. Data Model

### 3.1 Migration

```sql
alter table shopping.shopping_lists
  add column department_order jsonb;
```

- Stores an ordered array of department codes: `["produce", "dairy", "bakery", ...]`
- `NULL` means use the default order from the static `DEPARTMENTS` array in `departments.ts`
- Only shopping-type lists use this column; checklist/note/log types ignore it

### 3.2 TypeScript

Add to `ShoppingList` interface in `src/lib/supabase.ts`:

```ts
department_order: DepartmentCode[] | null;
```

### 3.3 Integration with existing groupByDepartment

`groupByDepartment` already accepts `userOrder?: Map<DepartmentCode, number>`. Build it from the saved array:

```ts
const orderMap = new Map(
  (list.department_order ?? []).map((code, i) => [code, i])
);
```

**New departments:** If an item's department is not present in the saved order (e.g., a new category appears after the order was set), it falls back to `department.order` from `DEPARTMENTS` — placing it last by default. This is already handled by the existing `userOrder?.get(code) ?? department.order` logic.

---

## 4. Hook — `useDepartmentOrder`

```ts
useDepartmentOrder(listId: string, initialOrder: DepartmentCode[] | null)
```

**Returns:**
- `orderMap: Map<DepartmentCode, number>` — passed directly to `groupByDepartment`
- `reorder(newCodes: DepartmentCode[]): void` — called after a drag completes

**Behavior:**
1. Local state initialized from `initialOrder` (no extra DB query; parent already has the list object)
2. `reorder(newCodes)`:
   - Immediately updates local state (optimistic)
   - `await db.from('shopping_lists').update({ department_order: newCodes }).eq('id', listId)`
   - On error: rolls back to previous state + `toast.error('שמירת הסדר נכשלה')`

---

## 5. Component Architecture

### 5.1 New: `SortableDepartmentGroup` (internal to `ActiveList`)

A wrapper that makes each department group (header + items) a sortable dnd-kit item:

```tsx
function SortableDepartmentGroup({ group, collapsed, onToggle, onItem... }) {
  const {
    setNodeRef, transform, transition, isDragging, attributes, listeners
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
        className={`grid transition-[grid-template-rows] duration-200 ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
        id={`dept-${group.department.code}-items`}
      >
        <div className="overflow-hidden">
          {group.items.map(it => <ItemRow key={it.id} item={it} ... />)}
        </div>
      </div>
    </div>
  );
}
```

**Note:** `position: sticky` on `DepartmentHeader` is temporarily disabled during drag (CSS `transform` creates a new stacking context that breaks sticky). This is acceptable given the brief duration of a drag gesture.

### 5.2 Modified: `DepartmentHeader`

Add `dragHandleProps` to props:

```ts
interface Props {
  department: DepartmentMeta;
  items: ListItem[];
  collapsed: boolean;
  onToggle: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}
```

Spread onto the existing `<button>`:

```tsx
<button
  type="button"
  onClick={onToggle}
  {...dragHandleProps}
  className={...}
  aria-expanded={!collapsed}
  aria-controls={`dept-${department.code}-items`}
>
```

**Click vs drag coexistence:** `PointerSensor` with `delay: 550` suppresses the click event when drag activates. Short taps still fire `onClick` (toggle collapse) normally — no code changes needed.

### 5.3 New: `DepartmentHeaderDragOverlay`

A minimal read-only version of the header for the drag preview:

```tsx
function DepartmentHeaderDragOverlay({ department, items }: Pick<Props, 'department' | 'items'>) {
  // Same visual as DepartmentHeader but:
  // - no onClick, no ref, no drag listeners
  // - box-shadow for "lifted" effect
  // - scale(1.02) via className
}
```

### 5.4 Modified: `ActiveList`

**New imports:** `DndContext`, `SortableContext`, `DragOverlay`, `closestCenter`, `verticalListSortingStrategy`, `arrayMove`, `useSensor`, `useSensors`, `PointerSensor`, `useDepartmentOrder`

**Sensor configuration:**
```ts
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { delay: 550, tolerance: 8 },
  })
);
```

**State:**
```ts
const [draggingCode, setDraggingCode] = useState<DepartmentCode | null>(null);
const { orderMap, reorder } = useDepartmentOrder(listId, list.department_order);
```

**`groupByDepartment` call** (already has the param, just pass it now):
```ts
const groups = useMemo(
  () => groupByDepartment(items, catalog, orderMap, nameOverrides),
  [items, catalog, orderMap, nameOverrides],
);
```

**Drag handlers:**
```ts
function handleDragStart(event: DragStartEvent) {
  setDraggingCode(event.active.id as DepartmentCode);
}

function handleDragEnd(event: DragEndEvent) {
  setDraggingCode(null);
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const codes = groups.map(g => g.department.code);
  const oldIndex = codes.indexOf(active.id as DepartmentCode);
  const newIndex = codes.indexOf(over.id as DepartmentCode);
  reorder(arrayMove(codes, oldIndex, newIndex));
}
```

**JSX structure:**
```tsx
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
    {groups.map(g => (
      <SortableDepartmentGroup
        key={g.department.code}
        group={g}
        collapsed={collapsed.has(g.department.code)}
        onToggle={() => toggleCollapsed(g.department.code)}
        {...itemHandlers}
      />
    ))}
  </SortableContext>
  <DragOverlay>
    {draggingCode && (() => {
      const g = groups.find(g => g.department.code === draggingCode);
      return g ? <DepartmentHeaderDragOverlay department={g.department} items={g.items} /> : null;
    })()}
  </DragOverlay>
</DndContext>
```

---

## 6. Props threading: list object into ActiveList

`ActiveList` currently receives only `listId: string`. It needs `list.department_order` to initialize the hook. Two options:

- Pass the full `ShoppingList` object as a prop — `list: ShoppingList`. The parent (`AppShell` / `App`) already loads the list for the sidebar, so no extra fetch is needed. `ActiveList`'s `Props` interface changes from `{ listId: string }` to `{ list: ShoppingList }`; `listId` is derived internally via `list.id`.

---

## 7. Dependencies

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

`@dnd-kit/utilities` provides `CSS.Transform.toString`.

---

## 8. Out of Scope

- "Reset to default order" button — can be added as a follow-up (just set `department_order: null`)
- Drag affordance icon (e.g., `≡` grip) on the header — the long-press behavior is discoverable via the existing app pattern; can be added as visual polish
- Order replication across lists — each list has its own independent order
