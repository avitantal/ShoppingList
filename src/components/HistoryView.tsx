import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { usePurchaseHistory } from '../hooks/usePurchaseHistory';
import { formatILS } from '../lib/format';

interface Props { listId: string; onClose: () => void; }

export function HistoryView({ listId, onClose }: Props) {
  const { entries, loading } = usePurchaseHistory(listId);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-stretch justify-center p-2">
      <div className="card w-full max-w-2xl p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">היסטוריית קניות</h2>
          <button className="btn-ghost p-2" onClick={onClose}><X size={18} /></button>
        </div>
        {loading && <div className="text-muted text-sm">טוען...</div>}
        {!loading && entries.length === 0 && (
          <div className="text-muted text-sm text-center p-8">אין קניות עדיין</div>
        )}
        <ul className="space-y-2">
          {entries.map(e => (
            <li key={e.id} className="border border-border rounded-lg">
              <button className="w-full px-3 py-2 flex items-center justify-between"
                      onClick={() => setOpen(o => ({ ...o, [e.id]: !o[e.id] }))}>
                <div className="text-right">
                  <div className="text-sm font-medium">{format(new Date(e.purchased_at), 'dd/MM/yyyy HH:mm')}</div>
                  <div className="text-xs text-muted">
                    {[e.store_chain, e.store_branch].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{formatILS(e.total_price)}</span>
                  {open[e.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>
              {open[e.id] && (
                <ul className="border-t border-border divide-y divide-border">
                  {e.lines.map(l => (
                    <li key={l.id} className="px-3 py-2 flex items-center justify-between text-sm">
                      <span>{l.name_snapshot}</span>
                      <span className="text-muted">{l.qty} · {formatILS(l.line_total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
