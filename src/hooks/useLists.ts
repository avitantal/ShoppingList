import { useCallback, useEffect, useState } from 'react';
import { supabase, type ShoppingList } from '../lib/supabase';

export function useLists() {
  const [owned, setOwned]   = useState<ShoppingList[]>([]);
  const [shared, setShared] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: user } = await supabase.auth.getUser();
    const uid = user?.user?.id;
    if (!uid) { setOwned([]); setShared([]); setLoading(false); return; }

    const { data: all } = await supabase
      .from('shopping_lists')
      .select('*')
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    const lists = (all ?? []) as ShoppingList[];
    setOwned( lists.filter(l => l.owner_id === uid));
    setShared(lists.filter(l => l.owner_id !== uid));
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  // Realtime: react to membership changes for me
  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id;
      if (!uid || !alive) return;
      const ch = supabase
        .channel('lists:membership:' + uid)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'list_members', filter: `user_id=eq.${uid}` },
            () => { void refresh(); })
        .subscribe();
      return () => { supabase.removeChannel(ch); };
    });
    return () => { alive = false; };
  }, [refresh]);

  return { owned, shared, loading, refresh };
}
