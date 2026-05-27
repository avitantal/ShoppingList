# Design — Multi-Type Lists

**Date:** 2026-05-27
**Author:** Claude + Avita (brainstorming session)
**Status:** Approved — ready for implementation plan

---

## 1. Goal

Expand the Shopping List app from a single list type to four distinct list types, each with its own UI and behavior, while sharing a unified data model that allows type conversion at runtime.

---

## 2. The Four Types

| Type | Icon | Description |
|---|---|---|
| `shopping` | 🛒 | Existing — departments, price comparison, cart total, product autocomplete |
| `checklist` | ✅ | Flat list with checkboxes. No departments, no prices, no product linking |
| `note` | 📝 | Single free-text textarea. Saved as one `list_items` row. Auto-save on idle |
| `log` | 📋 | Chronological entries with full timestamp (`DD.MM.YYYY HH:MM`). Edit and delete allowed |

---

## 3. Data Model

### 3.1 Migration (`0006_list_types.sql`)

```sql
create type shopping.list_type as enum ('shopping', 'checklist', 'note', 'log');

alter table shopping.shopping_lists
  add column list_type shopping.list_type not null default 'shopping';
```

Existing lists automatically receive `list_type = 'shopping'`.

`list_items` is **not modified** — all four types share the same table with the same columns.

### 3.2 Unified storage contract

| Type | How items are stored |
|---|---|
| shopping | Existing — barcode, estimated_price, department, qty, unit |
| checklist | `name` + `is_in_cart` (as "checked"). All other columns NULL |
| note | Single row — `name` holds the full textarea text blob |
| log | `name` holds the entry text. `created_at` is the immutable timestamp |

### 3.3 Type conversion RPC

```sql
shopping.change_list_type(p_list_id uuid, p_new_type shopping.list_type)
```

- Any → any: updates `list_type`, no data migration.
- `note` → any other type: splits the single text row by non-empty `\n` lines into individual `list_items` rows, then deletes the original blob row.
- Exposed to authenticated users (owner/editor via existing RLS).

### 3.4 New list creation

`NewListDialog` inserts directly into `shopping.shopping_lists` with the chosen `list_type`. No new RPC needed — the existing insert RLS policy allows authenticated owners to insert.

---

## 4. UX — Creating a List

Dialog flow (Option A — type first):

1. Dialog opens with 4 type cards (icon + label).
2. User selects a type (default: `shopping`).
3. User enters a list name.
4. Confirm → creates list with chosen type.

---

## 5. Component Architecture

### 5.1 Router

`ActiveList.tsx` becomes a type router:

```tsx
if (list.list_type === 'note')      return <NoteView list={list} />;
if (list.list_type === 'checklist') return <ChecklistView list={list} items={items} />;
if (list.list_type === 'log')       return <LogView list={list} items={items} />;
return <ShoppingListView list={list} items={items} />;
```

### 5.2 New components

| Component | Description |
|---|---|
| `ShoppingListView.tsx` | Current `ActiveList` logic, renamed. No logic changes |
| `ChecklistView.tsx` | `ItemRow` without departments/prices + `SimpleAddInput` |
| `NoteView.tsx` | `<textarea>` with debounced auto-save to the single `list_items` row |
| `LogView.tsx` | Chronological list, newest first, full timestamp, inline edit |
| `SimpleAddInput.tsx` | Plain text input (no product search) — used by checklist and log |

### 5.3 Modified components

| Component | Change |
|---|---|
| `NewListDialog.tsx` | Add 4-icon type picker before name field |
| `ActiveList.tsx` | Replace body with type router (logic moves to `ShoppingListView`) |
| `src/lib/supabase.ts` | Add `ListType` type; add `list_type: ListType` to `ShoppingList` interface |

### 5.4 Unchanged components

`AddItemInput.tsx`, `ItemRow.tsx`, `CartTotalFooter.tsx`, `DepartmentHeader.tsx`, `ChangeDepartmentSheet.tsx` — used only inside `ShoppingListView`, no changes needed.

---

## 6. Per-Type Behavior Details

### 6.1 Checklist
- Add item: `SimpleAddInput` → plain text, no autocomplete.
- Toggle: `is_in_cart` used as the checked state (consistent with shopping type).
- Checked items shown with strikethrough, pushed to bottom.
- No departments, no prices, no `CartTotalFooter`.

### 6.2 Note
- Single `<textarea>` fills the view.
- On load: fetch the single `list_items` row for this list; populate textarea. If 0 rows, textarea is empty.
- On change: debounce 800ms → upsert the single row (insert if none exists, update if one exists).
- No add-item input.

### 6.3 Log
- Items ordered by `created_at` DESC (newest at top).
- `SimpleAddInput` at top: on submit, inserts new row with current timestamp.
- Each entry shows: full `created_at` formatted as `DD.MM.YYYY · HH:MM`, entry text, edit (✏️) and delete (🗑) buttons.
- Edit: inline — replaces text with an `<input>`, saves on blur or Enter. `created_at` does not change on edit.
- Sharing: works via existing `list_members` — all members can add, edit, delete entries.

---

## 7. Sharing

All four types support sharing via the existing `list_members` infrastructure. No changes to sharing logic or RLS policies required.

---

## 8. Testing

| Test file | What it covers |
|---|---|
| `ActiveList.test.tsx` | Router renders correct component for each `list_type` |
| `NewListDialog.test.tsx` | Type picker visible, selected type passed to `onSubmit` |
| `ChecklistView.test.tsx` | No prices/departments rendered; checkbox toggle works |
| `NoteView.test.tsx` | Textarea loads content; auto-save fires after debounce; empty state doesn't crash |
| `LogView.test.tsx` | Timestamp displayed; add/edit/delete work; order is newest-first |
| Migration SQL | `list_type` column exists with `default 'shopping'`; existing rows unaffected |

---

## 9. Out of Scope

- Type conversion UI (button/menu to change type after creation) — can be added as a follow-up.
- Per-type icons in the sidebar — can be added as visual polish.
- Log entry categories (e.g., car / home / health) — explicit user decision: free text only.
- Rich text formatting in Note type.
- Undo on log delete.
