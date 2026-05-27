import { useEffect, useState } from 'react';
import type { ListItem } from '../lib/supabase';
import { useCheckout } from '../hooks/useCheckout';
import { formatILS } from '../lib/format';

interface Row { id: string; name: string; qty: number; unit_price: string; }
interface Props {
  listId: string;
  cartItems: ListItem[];
  onClose: () => void;
  onDone: () => void;
}

export function CheckoutDialog({ listId, cartItems, onClose, onDone }: Props) {
  const [storeChain, setStoreChain]   = useState('');
  const [storeBranch, setStoreBranch] = useState('');
  const [rows, setRows] = useState<Row[]>(cartItems.map(i => ({
    id: i.id, name: i.name, qty: Number(i.qty), unit_price: i.estimated_price?.toString() ?? '',
  })));
  const { checkout, submitting } = useCheckout(listId);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = rows.reduce((s, r) => {
    const up = parseFloat(r.unit_price);
    return Number.isFinite(up) ? s + up * (r.qty || 0) : s;
  }, 0);

  async function submit() {
    const id = await checkout({
      storeChain, storeBranch,
      items: rows.map(r => ({
        list_item_id: r.id,
        name: r.name,
        qty: r.qty,
        unit_price: r.unit_price === '' ? null : parseFloat(r.unit_price),
      })),
    });
    if (id) onDone();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-2">
      <div className="card w-full max-w-md p-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-3">סיום קנייה</h2>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <input className="input" placeholder="רשת (לדוגמה: שופרסל)" value={storeChain}
                 onChange={e => setStoreChain(e.target.value)} />
          <input className="input" placeholder="סניף" value={storeBranch}
                 onChange={e => setStoreBranch(e.target.value)} />
        </div>
        <div className="border border-border rounded-lg overflow-hidden mb-3">
          <div className="grid grid-cols-[1fr_70px_90px] gap-2 px-3 py-2 text-xs text-muted bg-surface">
            <div>פריט</div><div>נקנה בפועל</div><div>מחיר ליחידה</div>
          </div>
          {rows.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-[1fr_70px_90px] gap-2 px-3 py-2 border-t border-border items-center">
              <div className="text-sm truncate">{r.name}</div>
              <input type="number" min={0} step="0.01" className="input py-1 text-sm"
                     value={r.qty}
                     onChange={e => setRows(rs => rs.map((x,i) => i===idx ? { ...x, qty: parseFloat(e.target.value) || 0 } : x))} />
              <input type="number" min={0} step="0.01" className="input py-1 text-sm"
                     value={r.unit_price}
                     onChange={e => setRows(rs => rs.map((x,i) => i===idx ? { ...x, unit_price: e.target.value } : x))} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-sm text-muted">סה"כ</span>
            {total === 0 && (
              <div className="text-xs text-muted/70">הזן מחירים בשורות למעלה</div>
            )}
          </div>
          <span className="text-lg font-semibold">{total > 0 ? formatILS(total) : '—'}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>ביטול</button>
          <button className="btn-primary flex-1" disabled={submitting} onClick={() => void submit()}>
            {submitting ? 'שומר...' : 'אישור'}
          </button>
        </div>
      </div>
    </div>
  );
}
