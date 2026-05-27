import { Fragment, useMemo, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { useListItems } from '../hooks/useListItems';
import { useProductDepartments } from '../hooks/useProductDepartments';
import { useDepartmentNameOverrides } from '../hooks/useDepartmentNameOverrides';
import { useDepartmentCollapse } from '../hooks/useDepartmentCollapse';
import { ItemRow } from './ItemRow';
import { AddItemInput } from './AddItemInput';
import { CartTotalFooter } from './CartTotalFooter';
import { CheckoutDialog } from './CheckoutDialog';
import { LinkItemDialog } from './LinkItemDialog';
import { DepartmentHeader } from './DepartmentHeader';
import { ChangeDepartmentSheet } from './ChangeDepartmentSheet';
import { getProductLinkDefault, saveProductLinkDefault } from '../lib/productLinkDefaults';
import { groupByDepartment, getDepartmentForItem } from '../lib/departmentLookup';
import { db, type ListItem, type SearchProductResult } from '../lib/supabase';
import type { DepartmentCode } from '../lib/departments';

interface Props { listId: string; }

export function ActiveList({ listId }: Props) {
  const { items, addItem, setInCart, updateItem, deleteItem, restoreItem, refresh } = useListItems(listId);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null);
  const [editingDeptItemId, setEditingDeptItemId] = useState<string | null>(null);
  // Bumps to force a re-fetch / re-render of the catalog index after a
  // manual department override is written via RPC.
  const [catalogBust, setCatalogBust] = useState(0);
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

  const groups = useMemo(
    () => groupByDepartment(items, catalog, undefined, nameOverrides),
    [items, catalog, nameOverrides],
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
                {!isCollapsed && (
                  <div id={`dept-${g.department.code}-items`}>
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
                )}
              </Fragment>
            );
          })
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
        <CheckoutDialog listId={listId}
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
