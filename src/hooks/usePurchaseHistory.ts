import { useCallback, useEffect, useState } from 'react';
import { supabase, type PurchaseEvent, type PurchaseEventItem } from '../lib/supabase';

export interface HistoryEntry extends PurchaseEvent { lines: PurchaseEventItem[]; }

export function usePurchaseHistory(listId: string | null) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!listId) { setEntries([]); return; }
    setLoading(true);
    const { data: events } = await supabase
      .from('purchase_events')
      .select('*')
      .eq('list_id', listId)
      .order('purchased_at', { ascending: false });
    const ev = (events ?? []) as PurchaseEvent[];
    if (ev.length === 0) { setEntries([]); setLoading(false); return; }
    const { data: items } = await (supabase
      .from('purchase_event_items')
      .select('*') as unknown as { in: (col: string, ids: string[]) => Promise<{ data: unknown[] | null }> })
      .in('event_id', ev.map(e => e.id));
    const byEvent = new Map<string, PurchaseEventItem[]>();
    (items ?? []).forEach((row) => {
      const r = row as PurchaseEventItem;
      const arr = byEvent.get(r.event_id) ?? [];
      arr.push(r);
      byEvent.set(r.event_id, arr);
    });
    setEntries(ev.map(e => ({ ...e, lines: byEvent.get(e.id) ?? [] })));
    setLoading(false);
  }, [listId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { entries, loading, refresh };
}
