import { Minus, Plus, Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useEffect, useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { formatILS } from '../lib/format';
import { cn } from '../lib/utils';

interface Props {
  item: ListItem;
  onToggle: (next: boolean) => void;
  onQtyChange: (next: number) => void;
  onDelete: () => void;
}

export function ItemRow({ item, onToggle, onQtyChange, onDelete }: Props) {
  const [revealed, setRevealed] = useState(false);
  const handlers = useSwipeable({
    onSwipedRight: () => setRevealed(true),
    onSwipedLeft:  () => setRevealed(false),
    trackMouse: true,
    delta: 30,
  });

  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 3500);
    return () => clearTimeout(t);
  }, [revealed]);

  function dec() {
    const next = Math.max(1, Number(item.qty) - 1);
    if (next !== item.qty) onQtyChange(next);
  }
  function inc() {
    onQtyChange(Number(item.qty) + 1);
  }

  return (
    <div className="relative overflow-hidden">
      <button onClick={onDelete}
              className="absolute inset-y-0 end-0 w-20 bg-red-600 text-white flex items-center justify-center gap-1.5 text-sm font-medium"
              aria-label="מחק פריט"
              tabIndex={revealed ? 0 : -1}>
        <Trash2 size={18} />
        מחק
      </button>
      <div className={cn('flex items-center gap-2 p-3 border-b border-border bg-bg transition-transform duration-200 ease-out touch-pan-y',
                         revealed ? 'translate-x-20' : 'translate-x-0')}
           {...handlers}
           onClick={() => revealed && setRevealed(false)}>
        <input type="checkbox" checked={item.is_in_cart}
               onChange={e => onToggle(e.target.checked)}
               onClick={e => e.stopPropagation()}
               className="w-5 h-5 accent-indigo-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className={cn('text-sm font-medium truncate', item.is_in_cart && 'line-through text-muted')}>{item.name}</div>
          {(item.unit || item.estimated_price != null) && (
            <div className="text-xs text-muted truncate">
              {item.unit ?? ''}{item.unit && item.estimated_price != null ? ' · ' : ''}
              {item.estimated_price != null ? formatILS(item.estimated_price) : ''}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={dec}
                  disabled={Number(item.qty) <= 1}
                  className="btn-ghost p-1.5 disabled:opacity-30"
                  aria-label="הפחת כמות">
            <Minus size={14} />
          </button>
          <span className="min-w-6 text-center text-sm tabular-nums">{item.qty}</span>
          <button onClick={inc} className="btn-ghost p-1.5" aria-label="הוסף כמות">
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
