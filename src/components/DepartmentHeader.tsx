import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useMemo } from 'react';
import type { DepartmentMeta } from '../lib/departments';
import type { ListItem } from '../lib/supabase';
import { formatCompactILS } from '../lib/format';
import { cn } from '../lib/utils';

interface Props {
  department: DepartmentMeta;
  items: ListItem[];
  collapsed: boolean;
  onToggle: () => void;
}

export function DepartmentHeader({ department, items, collapsed, onToggle }: Props) {
  const { remainingCount, total } = useMemo(() => {
    let rc = 0;
    let t = 0;
    for (const i of items) {
      if (!i.is_in_cart) rc++;
      if (!i.is_in_cart && i.estimated_price != null) t += i.estimated_price * i.qty;
    }
    return { remainingCount: rc, total: t };
  }, [items]);

  const allDone = remainingCount === 0;
  // RTL: when expanded the caret points down; when collapsed it points
  // toward the inline-start side (right in RTL, hence ChevronLeft for
  // visual consistency with the rest of the app's RTL chevrons).
  const Caret = collapsed ? ChevronLeft : ChevronDown;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-2 py-1.5 pe-3 ps-3 bg-surface/60 border-b border-border text-sm font-semibold text-text/90 sticky top-0 z-10',
        allDone && 'text-emerald-300/80',
      )}
      aria-expanded={!collapsed}
      aria-controls={`dept-${department.code}-items`}
    >
      <Caret size={16} className="shrink-0 text-muted" />
      <span className="flex-1 text-start truncate">{department.name}</span>
      <span className="text-xs font-normal text-muted tabular-nums">
        {remainingCount > 0 ? `${remainingCount}` : '✓'}
        {total > 0 ? ` · ${formatCompactILS(total)}` : ''}
      </span>
    </button>
  );
}
