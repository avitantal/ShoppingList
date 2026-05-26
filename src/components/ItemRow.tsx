import { Link2, Minus, Plus, Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useEffect, useRef, useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { formatCompactILS } from '../lib/format';
import { cn } from '../lib/utils';

const REVEAL_WIDTH = 80;
const REVEAL_THRESHOLD = 40;
const BASE_PADDING = 12;

interface Props {
  item: ListItem;
  onToggle: (next: boolean) => void;
  onQtyChange: (next: number) => void;
  onDelete: () => void;
  onOpenLink: () => void;
}

export function ItemRow({ item, onToggle, onQtyChange, onDelete, onOpenLink }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const justSwiped = useRef(false);

  const handlers = useSwipeable({
    onSwiping: ({ deltaX, absX, absY }) => {
      // Bail when the gesture is primarily vertical — let the browser
      // scroll the list instead of fighting it with a horizontal drag.
      if (absY > absX) return;
      setDragging(true);
      const base = revealed ? REVEAL_WIDTH : 0;
      setDragX(Math.max(0, Math.min(REVEAL_WIDTH, base + deltaX)));
    },
    onSwiped: ({ deltaX, absX, absY }) => {
      setDragging(false);
      if (absY > absX) { setDragX(revealed ? REVEAL_WIDTH : 0); return; }
      const base = revealed ? REVEAL_WIDTH : 0;
      const open = base + deltaX >= REVEAL_THRESHOLD;
      setRevealed(open);
      setDragX(open ? REVEAL_WIDTH : 0);
      justSwiped.current = true;
      setTimeout(() => { justSwiped.current = false; }, 100);
    },
    trackMouse: true,
    // Higher threshold + passive listeners (preventScrollOnSwipe: false) so
    // the browser can scroll vertically smoothly without waiting for JS.
    // touch-action: pan-y on the row handles the horizontal/vertical split.
    delta: 18,
    preventScrollOnSwipe: false,
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

  const needsLink = !item.barcode;
  const hasPrice = item.estimated_price != null;

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
            'flex items-center gap-2 py-2.5 pe-3 border-b border-border bg-bg',
            item.is_in_cart && 'bg-emerald-500/10 border-emerald-400/20',
            !dragging && 'transition-[transform,padding] duration-200 ease-out'
          )}
           style={{
             transform: `translateX(${dragX}px)`,
             paddingInlineStart: `${BASE_PADDING + dragX}px`,
             touchAction: 'pan-y',
           }}
           {...handlers}
           onClick={dismiss}>
        <input type="checkbox" checked={item.is_in_cart}
               onChange={e => onToggle(e.target.checked)}
               onClick={e => e.stopPropagation()}
               className="w-5 h-5 accent-indigo-500 shrink-0" />
        <div className="flex-1 min-w-0 cursor-pointer"
             onClick={e => {
               if (revealed || justSwiped.current) return;
               e.stopPropagation();
               onOpenLink();
             }}>
          <div className={cn('flex items-center gap-1.5 text-sm font-medium min-w-0', item.is_in_cart && 'line-through text-emerald-200')}>
            {needsLink && (
              <span className="w-5 h-5 rounded-md bg-amber-400/10 text-amber-300 inline-flex items-center justify-center shrink-0"
                    title="קשר למוצר">
                <Link2 size={12} />
              </span>
            )}
            <span className="truncate">{item.name}</span>
          </div>
          {(item.unit || needsLink) && (
            <div className="text-xs text-muted truncate">
              {item.unit ?? ''}
              {item.unit && needsLink ? ' · ' : ''}
              {needsLink ? <span className="text-muted/80">אין מחיר · לחץ לקישור מוצר</span> : null}
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1" onClick={e => e.stopPropagation()}>
          <div className="min-w-16 text-left text-sm font-semibold tabular-nums text-text [direction:ltr]">
            {hasPrice ? formatCompactILS(item.estimated_price) : '—'}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={dec}
                    disabled={Number(item.qty) <= 1}
                    className="btn-ghost w-7 h-7 p-0 disabled:opacity-30"
                    aria-label="הפחת כמות">
              <Minus size={14} />
            </button>
            <span className="min-w-6 text-center text-sm tabular-nums">{item.qty}</span>
            <button onClick={inc} className="btn-ghost w-7 h-7 p-0" aria-label="הוסף כמות">
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
