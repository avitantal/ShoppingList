import { useMemo } from 'react';
import { GripVertical } from 'lucide-react';
import type { DepartmentMeta } from '../lib/departments';
import type { ListItem } from '../lib/supabase';
import { formatCompactILS } from '../lib/format';
import { cn } from '../lib/utils';

interface Props {
  department: DepartmentMeta;
  items: ListItem[];
}

export function DepartmentHeaderDragOverlay({ department, items }: Props) {
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

  return (
    <div
      className={cn(
        'w-full flex items-center gap-2 py-1.5 pe-3 ps-2 min-h-[36px] bg-surface border-b border-border border-s-2 text-xs font-semibold uppercase tracking-wider',
        'shadow-2xl scale-[1.02] origin-top cursor-grabbing',
        allDone
          ? 'text-emerald-400/80 border-s-emerald-500/60'
          : 'text-muted border-s-accent/70',
      )}
    >
      <GripVertical size={16} className="shrink-0 text-accent" />
      <span className="flex-1 text-start truncate">{department.name}</span>
      <span className="text-xs font-normal text-muted tabular-nums">
        {remainingCount > 0 ? `${remainingCount}` : '✓'}
        {total > 0 ? ` · ${formatCompactILS(total)}` : ''}
      </span>
    </div>
  );
}
