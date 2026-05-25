import { useMemo, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { useListItems } from '../hooks/useListItems';
import { ItemRow } from './ItemRow';
import { AddItemInput } from './AddItemInput';
import { CartTotalFooter } from './CartTotalFooter';
import { CheckoutDialog } from './CheckoutDialog';

interface Props { listId: string; }

export function ActiveList({ listId }: Props) {
  const { items, addItem, setInCart, updateItem, deleteItem, refresh } = useListItems(listId);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const cartCount = useMemo(() => items.filter(i => i.is_in_cart).length, [items]);

  return (
    <div className="flex flex-col h-full">
      <AddItemInput
        onAdd={async (name, barcode) => {
          const result = await addItem(name, barcode);
          if (barcode && result && !result.appliedBarcode) {
            toast('המוצר נוסף ללא מחיר');
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
                       onDelete={() => deleteItem(it.id)} />
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
    </div>
  );
}
