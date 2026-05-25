import { Info } from 'lucide-react';
import type { ListItem } from '../lib/supabase';

interface Props { items: ListItem[]; }

export function CartTotalFooter({ items }: Props) {
  if (items.length === 0) return null;

  const eligible = items.filter(i => !i.is_in_cart);
  const priced   = eligible.filter(i => i.estimated_price != null);
  if (priced.length === 0) return null;

  const total = priced.reduce((acc, i) => acc + (i.estimated_price ?? 0) * i.qty, 0);
  const missing = eligible.length - priced.length;
  // Hebrew: singular for count=1, plural otherwise. "1 פריטים" is ungrammatical.
  const missingLabel = missing === 1 ? 'פריט אחד ללא מחיר' : `${missing} פריטים ללא מחיר`;

  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 px-3 py-2 bg-surface border-t border-border text-sm">
      <span className="font-medium">סה״כ משוער: ₪{total.toFixed(2)}</span>
      {missing > 0 && (
        <span aria-label={missingLabel} title={missingLabel} className="text-muted-foreground">
          <Info size={14} />
        </span>
      )}
    </div>
  );
}
