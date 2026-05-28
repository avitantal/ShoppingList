import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
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

interface Props { list: ShoppingList; }

export function ActiveList({ list }: Props) {
  const { items, loading, addItem, setInCart, updateItem, deleteItem, restoreItem, refresh } = useListItems(list.id);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null);
  const [editingDeptItemId, setEditingDeptItemId] = useState<string | null>(null);
  // Bumps to force a re-fetch / re-render of the catalog index after a
  // manual department override is written via RPC.
  const [catalogBust, setCatalogBust] = useState(0);

  // On first load per list: auto-link unlinked items, then merge duplicates.
  const autoLinkedListId = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    if (autoLinkedListId.current === list.id) return;
    autoLinkedListId.current = list.id;

    void (async () => {
      // Local snapshot so we can track projected barcodes without waiting for React re-renders.
      const projected = items.map(i => ({ ...i }));

      // Step 1: link items that have a saved default.
      for (const item of projected.filter(i => !i.barcode)) {
        try {
          const product = await getProductLinkDefault(item.name);
          if (product) {
            await updateItem(item.id, {
              name: product.name,
              barcode: product.barcode,
              estimated_price: product.price,
            });
            Object.assign(item, { name: product.name, barcode: product.barcode, estimated_price: product.price });
          }
        } catch { /* silent */ }
      }

      // Step 2: merge items that now share a barcode.
      const byBarcode = new Map<string, typeof projected>();
      for (const item of projected) {
        if (!item.barcode) continue;
        const group = byBarcode.get(item.barcode);
        if (group) group.push(item);
        else byBarcode.set(item.barcode, [item]);
      }
      for (const [, group] of byBarcode) {
        if (group.length < 2) continue;
        const [keep, ...dupes] = group;
        const totalQty = group.reduce((sum, i) => sum + Number(i.qty), 0);
        try {
          await updateItem(keep.id, { qty: totalQty });
          for (const dupe of dupes) await deleteItem(dupe.id);
        } catch { /* silent */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id, loading]);
  const cartCount = useMemo(() => items.filter(i => i.is_in_cart).length, [items]);
  const linkingItem = linkingItemId ? items.find(i => i.id === linkingItemId) ?? null : null;
  const editingDeptItem = editingDeptItemId ? items.find(i => i.id === editingDeptItemId) ?? null : null;

  const barcodes = useMemo(
    () => items.map(i => i.barcode).filter((b): b is string => !!b),
    // catalogBust forces the dedupedKey inside the hook to recompute via
    // a new array identity; the hook itself dedupes string content.
    [items, catalogBust],
  );
  const catalog = useProductDepartments(barcodes);
  const { overrides: nameOverrides, setOverride: setNameOverride } = useDepartmentNameOverrides();
  const { collapsed, toggle: toggleCollapsed } = useDepartmentCollapse();
  const { orderMap, reorder } = useDepartmentOrder(list.id, list.department_order);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 550, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 550, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [draggingCode, setDraggingCode] = useState<string | null>(null);

  const groups = useMemo(
    () => groupByDepartment(items, catalog, orderMap, nameOverrides),
    [items, catalog, orderMap, nameOverrides],
  );

  async function applyProduct(item: ListItem, product: Pick<SearchProductResult, 'name' | 'barcode' | 'price'> | { name: string; barcode: string; estimated_price: number }) {
    const estimatedPrice = 'estimated_price' in product ? product.estimated_price : product.price;
    await updateItem(item.id, {
      name: product.name,
      barcode: product.barcode,
      estimated_price: estimatedPrice,
    });
  }

  function openLink(item: ListItem) {
    if (item.barcode) {
      setLinkingItemId(item.id);
      return;
    }

    void (async () => {
      const product = await getProductLinkDefault(item.name);
      if (!product) {
        setLinkingItemId(item.id);
        return;
      }
      await applyProduct(item, product);
      return product;
    })()
      .then((product) => {
        if (!product) return;
        toast.success(`קושר אוטומטית ל-${product.name}`, {
          action: {
            label: 'שנה',
            onClick: () => setLinkingItemId(item.id),
          },
        });
      })
      .catch(() => {
        toast.error('לא הצלחתי לקשר אוטומטית');
        setLinkingItemId(item.id);
      });
  }

  function deleteWithUndo(item: ListItem) {
    const deletion = deleteItem(item.id);
    toast(`נמחק ${item.name}`, {
      duration: 7000,
      action: {
        label: 'בטל',
        onClick: () => {
          void deletion
            .then(() => restoreItem(item))
            .catch(() => undefined);
        },
      },
    });
    void deletion.catch(() => toast.error('מחיקת הפריט נכשלה'));
  }

  async function applyDepartmentOverride(item: ListItem, code: DepartmentCode) {
    if (item.barcode) {
      const { error } = await db.rpc('set_department_override', {
        p_barcode: item.barcode,
        p_department_code: code,
      });
      if (error) {
        toast.error('שמירת המחלקה נכשלה');
        return;
      }
      setCatalogBust((n) => n + 1);
    } else {
      setNameOverride(item.name, code);
    }
  }

  function handleDragStart({ active }: DragStartEvent) {
    setDraggingCode(active.id as string);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDraggingCode(null);
    if (!over || active.id === over.id) return;
    const codes = groups.map(g => g.department.code);
    const oldIndex = codes.indexOf(active.id as DepartmentCode);
    const newIndex = codes.indexOf(over.id as DepartmentCode);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(codes, oldIndex, newIndex));
  }

  return (
    <div className="flex flex-col h-full">
      <AddItemInput
        onAdd={async (name, barcode, suggestion) => {
          const result = await addItem(name, barcode);
          if (barcode && result && !result.appliedBarcode) {
            toast('המוצר נוסף ללא מחיר');
            return;
          }
          // Free-text path: if a catalog match exists, offer a one-click swap.
          if (!barcode && suggestion && result?.itemId) {
            const newItemId = result.itemId;
            const sug = suggestion;
            toast(`האם התכוונת ל-${sug.name}?`, {
              action: {
                label: 'החלף',
                onClick: () => {
                  void (async () => {
                    await deleteItem(newItemId);
                    await addItem(sug.name, sug.barcode);
                  })();
                },
              },
            });
          }
        }}
      />
      <div className="flex-1 overflow-y-auto">
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
        <CartTotalFooter items={items} />
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
        <CheckoutDialog listId={list.id}
                        cartItems={items.filter(i => i.is_in_cart)}
                        onClose={() => setCheckoutOpen(false)}
                        onDone={() => { setCheckoutOpen(false); void refresh(); }} />
      )}
      {linkingItem && (
        <LinkItemDialog initialQuery={linkingItem.name}
                        onClose={() => setLinkingItemId(null)}
                        onPick={(p) => {
                          const originalName = linkingItem.name;
                          void (async () => {
                            await applyProduct(linkingItem, p);
                            try {
                              await saveProductLinkDefault(originalName, p);
                            } catch {
                              toast.error('הפריט קושר, אבל ברירת המחדל לא נשמרה');
                              return;
                            }
                            toast.success(`קושר ל-${p.name}`);
                          })();
                          setLinkingItemId(null);
                        }} />
      )}
      {editingDeptItem && (
        <ChangeDepartmentSheet
          itemName={editingDeptItem.name}
          currentDepartment={getDepartmentForItem(editingDeptItem, catalog, nameOverrides)}
          onClose={() => setEditingDeptItemId(null)}
          onPick={(code) => {
            void applyDepartmentOverride(editingDeptItem, code);
            setEditingDeptItemId(null);
          }}
        />
      )}
    </div>
  );
}
