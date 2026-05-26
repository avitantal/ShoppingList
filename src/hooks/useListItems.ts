import { useCallback, useEffect, useState } from 'react';
import { supabase, db, SHOPPING_SCHEMA, type ListItem } from '../lib/supabase';

function sortListItems(items: ListItem[]): ListItem[] {
  return [...items].sort((a, b) =>
    a.sort_order - b.sort_order ||
    Date.parse(a.created_at) - Date.parse(b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

export function useListItems(listId: string | null) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!listId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await db
      .from('list_items')
      .select('*')
      .eq('list_id', listId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    setItems(sortListItems((data ?? []) as ListItem[]));
    setLoading(false);
  }, [listId]);

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!listId) return;
    // Unique channel name avoids StrictMode double-mount reusing an already-
    // subscribed channel, which throws when adding .on() callbacks again.
    const ch = supabase
      .channel(`list:${listId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: SHOPPING_SCHEMA, table: 'list_items',      filter: `list_id=eq.${listId}` }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: SHOPPING_SCHEMA, table: 'purchase_events', filter: `list_id=eq.${listId}` }, () => { void refresh(); });
    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [listId, refresh]);

  async function addItem(name: string, barcode?: string, qty: number | null = null, unit: string | null = null) {
    if (!listId) return;
    const { data } = await db.rpc('add_item', {
      p_list_id: listId,
      p_name: name,
      p_qty: qty,
      p_unit: unit,
      p_barcode: barcode ?? null,
    });
    await refresh();
    // RPC returns table(item_id uuid, barcode_applied boolean) — supabase-js
    // surfaces it as data: [{ item_id, barcode_applied }] or sometimes a single row
    // depending on Postgrest mode.
    const row = Array.isArray(data) ? data[0] : data;
    const applied = !!(row && row.barcode_applied);
    const itemId = (row && row.item_id) as string | undefined;
    return { appliedBarcode: barcode != null && applied, itemId };
  }

  async function setInCart(itemId: string, inCart: boolean) {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, is_in_cart: inCart } : i));
    const { error } = await db.from('list_items').update({ is_in_cart: inCart }).eq('id', itemId);
    if (error) { await refresh(); throw error; }
  }

  async function updateItem(itemId: string, patch: Partial<Pick<ListItem, 'name' | 'qty' | 'unit' | 'notes' | 'estimated_price' | 'sort_order' | 'barcode'>>) {
    setItems(prev => sortListItems(prev.map(i => i.id === itemId ? { ...i, ...patch } : i)));
    const { error } = await db.from('list_items').update(patch).eq('id', itemId);
    if (error) { await refresh(); throw error; }
  }

  async function deleteItem(itemId: string) {
    setItems(prev => prev.filter(i => i.id !== itemId));
    const { error } = await db.from('list_items').delete().eq('id', itemId);
    if (error) { await refresh(); throw error; }
  }

  async function restoreItem(item: ListItem) {
    setItems(prev => sortListItems([...prev.filter(i => i.id !== item.id), item]));
    const { error } = await db.from('list_items').insert(item);
    if (error) { await refresh(); throw error; }
  }

  return { items, loading, refresh, addItem, setInCart, updateItem, deleteItem, restoreItem };
}
