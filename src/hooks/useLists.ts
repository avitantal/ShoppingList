import { useCallback, useEffect, useState } from 'react';
import { supabase, db, SHOPPING_SCHEMA, type ShoppingList } from '../lib/supabase';

export function useLists() {
  const [owned, setOwned]   = useState<ShoppingList[]>([]);
  const [shared, setShared] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: user } = await supabase.auth.getUser();
      const uid = user?.user?.id;
      if (!uid) { setOwned([]); setShared([]); return; }

      const { data: all, error: selectErr } = await db
        .from('shopping_lists')
        .select('*')
        .is('archived_at', null)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      if (selectErr) {
        setError(selectErr.message ?? 'שגיאה בטעינת רשימות');
        setOwned([]); setShared([]);
        return;
      }

      const lists = (all ?? []) as ShoppingList[];
      const ownedLists = lists.filter(l => l.owner_id === uid);
      setOwned(ownedLists);
      setShared(lists.filter(l => l.owner_id !== uid));

      // Auto-create a default list on first ShoppingList load. (We do this here
      // instead of via an auth.users trigger so we don't pollute the shared
      // auth.users table with side effects for non-ShoppingList users.)
      if (ownedLists.length === 0) {
        const { data: newId, error: rpcErr } = await db.rpc('create_list',
          { p_name: 'הרשימה שלי', p_make_default: true });
        if (rpcErr) {
          setError(rpcErr.message ?? 'שגיאה ביצירת רשימת ברירת מחדל');
          return;
        }
        if (newId) {
          const { data: refreshed } = await db
            .from('shopping_lists').select('*').is('archived_at', null)
            .order('is_default', { ascending: false }).order('created_at', { ascending: true });
          const all2 = (refreshed ?? []) as ShoppingList[];
          setOwned(all2.filter(l => l.owner_id === uid));
          setShared(all2.filter(l => l.owner_id !== uid));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  // Realtime: react to membership changes for me
  useEffect(() => {
    let alive = true;
    // Create channel synchronously with a fresh, unique name so StrictMode's
    // double-mount can't reuse an already-subscribed channel (which throws
    // "cannot add postgres_changes callbacks ... after subscribe()").
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`lists:membership:${uid}:${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes',
            { event: '*', schema: SHOPPING_SCHEMA, table: 'list_members', filter: `user_id=eq.${uid}` },
            () => { void refresh(); });
      channel.subscribe();
    });
    return () => {
      alive = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { owned, shared, loading, error, refresh };
}
