import { useMemo, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { useListItems } from '../hooks/useListItems';
import { ItemRow } from './ItemRow';
import { AddItemInput } from './AddItemInput';
import { CartTotalFooter } from './CartTotalFooter';
import { CheckoutDialog } from './CheckoutDialog';
import { LinkItemDialog } from './LinkItemDialog';
import { getProductLinkDefault, saveProductLinkDefault } from '../lib/productLinkDefaults';
import type { ListItem, SearchProductResult } from '../lib/supabase';

interface Props { listId: string; }

export function ActiveList({ listId }: Props) {
  const { items, addItem, setInCart, updateItem, deleteItem, restoreItem, refresh } = useListItems(listId);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null);
  const cartCount = useMemo(() => items.filter(i => i.is_in_cart).length, [items]);
  const linkingItem = linkingItemId ? items.find(i => i.id === linkingItemId) ?? null : null;

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

    const product = getProductLinkDefault(item.name);
    if (!product) {
      setLinkingItemId(item.id);
      return;
    }

    void applyProduct(item, product)
      .then(() => {
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
        {items.length === 0
          ? <div className="text-center text-muted p-8 text-sm">הרשימה ריקה — הוסף את הפריט הראשון</div>
          : items.map(it => (
              <ItemRow key={it.id} item={it}
                       onToggle={(next) => setInCart(it.id, next)}
                       onQtyChange={(next) => updateItem(it.id, { qty: next })}
                       onDelete={() => deleteWithUndo(it)}
                       onOpenLink={() => openLink(it)} />
            ))}
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
                          saveProductLinkDefault(linkingItem.name, p);
                          void applyProduct(linkingItem, p);
                          setLinkingItemId(null);
                          toast.success(`קושר ל-${p.name}`);
                        }} />
      )}
    </div>
  );
}
