import { useCallback, useEffect, useState } from 'react';
import { db, type PurchaseEvent, type PurchaseEventItem } from '../lib/supabase';

export interface HistoryEntry extends PurchaseEvent { lines: PurchaseEventItem[]; }

export function usePurchaseHistory(listId: string | null) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!listId) { setEntries([]); return; }
    setLoading(true);
    const { data: events } = await db
      .from('purchase_events')
      .select('*')
      .eq('list_id', listId)
      .order('purchased_at', { ascending: false });
    const ev = (events ?? []) as PurchaseEvent[];
    if (ev.length === 0) { setEntries([]); setLoading(false); return; }
    const { data: items } = await db
      .from('purchase_event_items')
      .select('*')
      .in('event_id', ev.map(e => e.id));
    const byEvent = new Map<string, PurchaseEventItem[]>();
    ((items ?? []) as PurchaseEventItem[]).forEach((r) => {
      const arr = byEvent.get(r.event_id) ?? [];
      arr.push(r);
      byEvent.set(r.event_id, arr);
    });
    setEntries(ev.map(e => ({ ...e, lines: byEvent.get(e.id) ?? [] })));
    setLoading(false);
  }, [listId]);

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  return { entries, loading, refresh };
}
