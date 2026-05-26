import { Link2, Minus, Plus, Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useRef, useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { formatCompactILS } from '../lib/format';
import { cn } from '../lib/utils';

const DELETE_THRESHOLD = 72;
const MAX_DRAG = 96;
const BASE_PADDING = 12;

interface Props {
  item: ListItem;
  onToggle: (next: boolean) => void;
  onQtyChange: (next: number) => void;
  onDelete: () => void;
  onOpenLink: () => void;
}

export function ItemRow({ item, onToggle, onQtyChange, onDelete, onOpenLink }: Props) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const justSwiped = useRef(false);
  const deletedBySwipe = useRef(false);

  const handlers = useSwipeable({
    onSwiping: ({ deltaX, absX, absY }) => {
      // Bail when the gesture is primarily vertical — let the browser
      // scroll the list instead of fighting it with a horizontal drag.
      if (absY > absX) return;
      setDragging(true);
      setDragX(Math.max(-MAX_DRAG, Math.min(MAX_DRAG, deltaX)));
    },
    onSwiped: ({ absX, absY }) => {
      setDragging(false);
      justSwiped.current = true;
      setTimeout(() => { justSwiped.current = false; }, 100);
      if (absY > absX) { setDragX(0); return; }
      if (absX >= DELETE_THRESHOLD) {
        deletedBySwipe.current = true;
        onDelete();
        return;
      }
      setDragX(0);
    },
    trackMouse: true,
    // Higher threshold + passive listeners (preventScrollOnSwipe: false) so
    // the browser can scroll vertically smoothly without waiting for JS.
    // touch-action: pan-y on the row handles the horizontal/vertical split.
    delta: 18,
    preventScrollOnSwipe: false,
  });

  function dec() {
    const next = Math.max(1, Number(item.qty) - 1);
    if (next !== item.qty) onQtyChange(next);
  }
  function inc() {
    onQtyChange(Number(item.qty) + 1);
  }

  function dismiss() {
    setDragX(0);
  }

  const needsLink = !item.barcode;
  const hasPrice = item.estimated_price != null;

  return (
    <div className="relative overflow-hidden">
      <div className={cn(
             'absolute inset-0 px-4 flex items-center justify-between bg-red-600/20 text-red-200 transition-opacity pointer-events-none',
             Math.abs(dragX) > 8 ? 'opacity-100' : 'opacity-0'
           )}
           aria-hidden="true">
        <Trash2 size={18} />
        <Trash2 size={18} />
      </div>
      <div className={cn(
            'flex items-center gap-2 py-2.5 pe-3 border-b border-border bg-bg',
            item.is_in_cart && 'bg-emerald-500/10 border-emerald-400/20',
            !dragging && 'transition-[transform,padding] duration-200 ease-out'
          )}
           style={{
             transform: `translateX(${dragX}px)`,
             paddingInlineStart: `${BASE_PADDING}px`,
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
               if (justSwiped.current || deletedBySwipe.current) return;
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
