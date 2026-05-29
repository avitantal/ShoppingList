import { Info } from 'lucide-react';
import type { ListItem } from '../lib/supabase';

interface Props { items: ListItem[]; }

export function CartTotalFooter({ items }: Props) {
  if (items.length === 0) return null;

  const unchecked = items.filter(i => !i.is_in_cart);
  const checked   = items.filter(i => i.is_in_cart);

  const uncheckedPriced = unchecked.filter(i => i.estimated_price != null);
  const checkedPriced   = checked.filter(i => i.estimated_price != null);

  if (uncheckedPriced.length === 0 && checkedPriced.length === 0) return null;

  const estimatedTotal = uncheckedPriced.reduce((acc, i) => acc + (i.estimated_price ?? 0) * i.qty, 0);
  const cartSubtotal   = checkedPriced.reduce((acc, i) => acc + (i.estimated_price ?? 0) * i.qty, 0);

  const missing = unchecked.length - uncheckedPriced.length;
  const missingLabel = missing === 1 ? 'פריט אחד ללא מחיר' : `${missing} פריטים ללא מחיר`;

  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 px-3 py-2 bg-surface border-t border-border text-sm">
      <div className="flex flex-col gap-0.5">
        {checkedPriced.length > 0 && (
          <span className="font-semibold text-emerald-400">סה״כ בסל: ₪{cartSubtotal.toFixed(2)}</span>
        )}
        {uncheckedPriced.length > 0 && (
          <span className="font-medium text-muted">סה״כ משוער: ₪{estimatedTotal.toFixed(2)}</span>
        )}
      </div>
      {missing > 0 && (
        <span aria-label={missingLabel} title={missingLabel} className="text-muted-foreground">
          <Info size={14} />
        </span>
      )}
    </div>
  );
}
