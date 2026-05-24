import { Minus, Plus, Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useState } from 'react';
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
    onSwipedLeft:  () => setRevealed(true),
    onSwipedRight: () => setRevealed(false),
    trackMouse: true,
  });

  function dec() {
    const next = Math.max(1, Number(item.qty) - 1);
    if (next !== item.qty) onQtyChange(next);
  }
  function inc() {
    onQtyChange(Number(item.qty) + 1);
  }

  return (
    <div className="relative">
      <div className={cn('flex items-center gap-2 p-3 border-b border-border bg-bg transition-transform',
                         revealed && '-translate-x-16')}
           {...handlers}>
        <input type="checkbox" checked={item.is_in_cart}
               onChange={e => onToggle(e.target.checked)}
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
        <div className="flex items-center gap-1 shrink-0">
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
          <button onClick={onDelete}
                  className="btn-ghost p-1.5 text-red-400 hover:text-red-300 ms-1"
                  aria-label="מחק פריט">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <button onClick={onDelete}
              className="absolute inset-y-0 left-0 w-16 bg-red-600/80 text-white flex items-center justify-center"
              aria-label="מחק פריט">
        <Trash2 size={18} />
      </button>
    </div>
  );
}
