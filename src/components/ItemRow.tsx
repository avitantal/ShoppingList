import { Building2, Link2, Minus, Plus, Trash2 } from 'lucide-react';
import { useSwipeable } from 'react-swipeable';
import { useRef, useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { formatCompactILS } from '../lib/format';
import { cn } from '../lib/utils';
import { useLongPress } from '../hooks/useLongPress';

const DELETE_THRESHOLD = 72;
const MAX_DRAG = 96;
const BASE_PADDING = 12;

interface Props {
  item: ListItem;
  onToggle: (next: boolean) => void;
  onQtyChange: (next: number) => void;
  onDelete: () => void;
  onOpenLink: () => void;
  onChangeDepartment?: () => void;
}

export function ItemRow({ item, onToggle, onQtyChange, onDelete, onOpenLink, onChangeDepartment }: Props) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const justSwiped = useRef(false);
  const deletedBySwipe = useRef(false);
  const justLongPressed = useRef(false);

  const longPress = useLongPress(
    onChangeDepartment
      ? () => {
          justLongPressed.current = true;
          window.setTimeout(() => { justLongPressed.current = false; }, 400);
          onChangeDepartment();
        }
      : null,
  );

  const handlers = useSwipeable({
    onSwiping: ({ deltaX, absX, absY }) => {
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
  const swiping = Math.abs(dragX) > 8;

  return (
    <div className="relative overflow-hidden group">
      {/* Swipe-to-delete background — left side only (RTL: inline-end = natural delete direction) */}
      <div className={cn(
             'absolute inset-0 px-4 flex items-center justify-start bg-red-600/20 text-red-200 transition-opacity pointer-events-none',
             swiping ? 'opacity-100' : 'opacity-0'
           )}
           aria-hidden="true">
        <Trash2 size={18} />
      </div>
      {/* Passive swipe affordance — faint trash hint always visible on the left edge */}
      {!swiping && (
        <div className="absolute inset-y-0 start-0 w-10 flex items-center justify-center text-muted/20 pointer-events-none" aria-hidden="true">
          <Trash2 size={14} />
        </div>
      )}
      <div className={cn(
            'flex items-center gap-2 py-2 pe-2 border-b border-border bg-bg',
            item.is_in_cart && 'bg-emerald-500/10 border-emerald-400/20',
            !dragging && 'transition-[transform,padding] duration-200 ease-out'
          )}
           style={{
             transform: `translateX(${dragX}px)`,
             paddingInlineStart: `${BASE_PADDING}px`,
             touchAction: 'pan-y',
           }}
           {...handlers}
           {...longPress}
           onClick={dismiss}>
        <input type="checkbox" checked={item.is_in_cart}
               onChange={e => onToggle(e.target.checked)}
               onClick={e => e.stopPropagation()}
               className="w-5 h-5 accent-indigo-500 shrink-0" />
        <div className="flex-1 min-w-0 cursor-pointer"
             role="button"
             tabIndex={0}
             aria-label={`קשר מוצר: ${item.name}`}
             onClick={e => {
               if (justSwiped.current || deletedBySwipe.current || justLongPressed.current) return;
               e.stopPropagation();
               onOpenLink();
             }}
             onKeyDown={e => {
               if (e.key === 'Enter' || e.key === ' ') {
                 e.preventDefault();
                 e.stopPropagation();
                 onOpenLink();
               }
             }}>
          <div className={cn('flex items-center gap-1.5 text-sm font-medium min-w-0', item.is_in_cart && 'line-through text-emerald-200')}>
            {needsLink && (
              <span className="w-4 h-4 rounded bg-amber-400/10 text-amber-300 inline-flex items-center justify-center shrink-0"
                    title="קשר למוצר">
                <Link2 size={10} />
              </span>
            )}
            <span className="truncate">{item.name}</span>
            {item.unit && <span className="text-xs text-muted shrink-0">{item.unit}</span>}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <div className="min-w-14 text-right text-sm font-semibold tabular-nums text-text [direction:ltr]">
            {hasPrice ? formatCompactILS(item.estimated_price) : '—'}
          </div>
          {/* Desktop-only department change button — touch uses long-press */}
          {onChangeDepartment && (
            <button
              type="button"
              onClick={onChangeDepartment}
              className="btn-ghost w-7 h-7 p-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity hidden [@media(hover:hover)]:flex"
              aria-label="שנה מחלקה"
              title="שנה מחלקה"
            >
              <Building2 size={13} />
            </button>
          )}
          <button onClick={dec}
                  disabled={Number(item.qty) <= 1}
                  className="btn-ghost w-9 h-9 p-0 disabled:opacity-30"
                  aria-label="הפחת כמות">
            <Minus size={14} />
          </button>
          <span className="min-w-5 text-center text-sm tabular-nums">{item.qty}</span>
          <button onClick={inc} className="btn-ghost w-9 h-9 p-0" aria-label="הוסף כמות">
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
