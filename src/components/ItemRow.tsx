import { Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { formatILS } from '../lib/format';
import { cn } from '../lib/utils';

interface Props {
  item: ListItem;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
}

export function ItemRow({ item, onToggle, onDelete }: Props) {
  const [revealed, setRevealed] = useState(false);
  const handlers = useSwipeable({
    onSwipedLeft:  () => setRevealed(true),
    onSwipedRight: () => setRevealed(false),
    trackMouse: true,
  });

  return (
    <div className="relative">
      <div className={cn('flex items-center gap-3 p-3 border-b border-border bg-bg transition-transform',
                         revealed && '-translate-x-16')}
           {...handlers}>
        <input type="checkbox" checked={item.is_in_cart}
               onChange={e => onToggle(e.target.checked)}
               className="w-5 h-5 accent-indigo-500" />
        <div className="flex-1 min-w-0">
          <div className={cn('text-sm font-medium truncate', item.is_in_cart && 'line-through text-muted')}>{item.name}</div>
          {(item.qty !== 1 || item.unit) && (
            <div className="text-xs text-muted">{item.qty}{item.unit ? ` ${item.unit}` : ''}</div>
          )}
        </div>
        <div className="text-xs text-muted whitespace-nowrap">{formatILS(item.estimated_price)}</div>
      </div>
      <button onClick={onDelete}
              className="absolute inset-y-0 left-0 w-16 bg-red-600/80 text-white flex items-center justify-center"
              aria-label="מחק פריט">
        <Trash2 size={18} />
      </button>
    </div>
  );
}
