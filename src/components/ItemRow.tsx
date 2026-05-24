import { Minus, Plus, Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useEffect, useRef, useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { formatILS } from '../lib/format';
import { cn } from '../lib/utils';

const REVEAL_WIDTH = 80;
const REVEAL_THRESHOLD = 40;
const BASE_PADDING = 12;

interface Props {
  item: ListItem;
  onToggle: (next: boolean) => void;
  onQtyChange: (next: number) => void;
  onDelete: () => void;
}

export function ItemRow({ item, onToggle, onQtyChange, onDelete }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const justSwiped = useRef(false);

  const handlers = useSwipeable({
    onSwiping: ({ deltaX }) => {
      setDragging(true);
      const base = revealed ? REVEAL_WIDTH : 0;
      setDragX(Math.max(0, Math.min(REVEAL_WIDTH, base + deltaX)));
    },
    onSwiped: ({ deltaX }) => {
      setDragging(false);
      const base = revealed ? REVEAL_WIDTH : 0;
      const open = base + deltaX >= REVEAL_THRESHOLD;
      setRevealed(open);
      setDragX(open ? REVEAL_WIDTH : 0);
      justSwiped.current = true;
      setTimeout(() => { justSwiped.current = false; }, 100);
    },
    trackMouse: true,
    delta: 5,
    preventScrollOnSwipe: true,
  });

  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => {
      setRevealed(false);
      setDragX(0);
    }, 3500);
    return () => clearTimeout(t);
  }, [revealed]);

  function dec() {
    const next = Math.max(1, Number(item.qty) - 1);
    if (next !== item.qty) onQtyChange(next);
  }
  function inc() {
    onQtyChange(Number(item.qty) + 1);
  }

  function dismiss() {
    if (!revealed || justSwiped.current) return;
    setRevealed(false);
    setDragX(0);
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
      <div className={cn(
            'flex items-center gap-2 py-3 pe-3 border-b border-border bg-bg',
            !dragging && 'transition-[transform,padding] duration-200 ease-out'
          )}
           style={{
             transform: `translateX(${dragX}px)`,
             paddingInlineStart: `${BASE_PADDING + dragX}px`,
           }}
           {...handlers}
           onClick={dismiss}>
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
