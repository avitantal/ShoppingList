import { useCallback, useEffect, useState } from 'react';
import { supabase, type ListItem } from '../lib/supabase';

export function useListItems(listId: string | null) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!listId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('list_items')
      .select('*')
      .eq('list_id', listId)
      .order('sort_order', { ascending: true });
    setItems((data ?? []) as ListItem[]);
    setLoading(false);
  }, [listId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!listId) return;
    const ch = supabase
      .channel(`list:${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items',      filter: `list_id=eq.${listId}` }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_events', filter: `list_id=eq.${listId}` }, () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [listId, refresh]);

  async function addItem(name: string, qty = 1, unit: string | null = null) {
    if (!listId) return;
    await supabase.rpc('add_item', { p_list_id: listId, p_name: name, p_qty: qty, p_unit: unit });
    await refresh();
  }

  async function setInCart(itemId: string, inCart: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('list_items') as any).update({ is_in_cart: inCart }).eq('id', itemId);
  }

  async function updateItem(itemId: string, patch: Partial<Pick<ListItem, 'name' | 'qty' | 'unit' | 'notes' | 'estimated_price' | 'sort_order'>>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('list_items') as any).update(patch).eq('id', itemId);
  }

  async function deleteItem(itemId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('list_items') as any).delete().eq('id', itemId);
  }

  return { items, loading, refresh, addItem, setInCart, updateItem, deleteItem };
}
