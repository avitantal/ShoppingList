import { useEffect, useState } from 'react';
import { Menu, Share2 } from 'lucide-react';
import { useLists } from '../hooks/useLists';
import { ListSidebar } from './ListSidebar';
import { ActiveList } from './ActiveList';
import { ShareDialog } from './ShareDialog';
import { HistoryView } from './HistoryView';
import { supabase } from '../lib/supabase';

const LS_KEY = 'activeListId';

export function AppShell() {
  const { owned, shared, loading, refresh } = useLists();
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(LS_KEY));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shareOpen,  setShareOpen]  = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Default-select once lists arrive
  useEffect(() => {
    if (loading) return;
    const all = [...owned, ...shared];
    if (all.length === 0) return;
    if (!activeId || !all.some(l => l.id === activeId)) {
      const fallback = owned.find(l => l.is_default)?.id ?? all[0].id;
      setActiveId(fallback);
      localStorage.setItem(LS_KEY, fallback);
    }
  }, [loading, owned, shared, activeId]);

  function selectList(id: string) {
    setActiveId(id); localStorage.setItem(LS_KEY, id); setDrawerOpen(false);
  }

  // Refresh on sign-in (belt-and-braces per spec §8)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, _s) => { void refresh(); });
    return () => { sub.subscription.unsubscribe(); };
  }, [refresh]);

  const active = [...owned, ...shared].find(l => l.id === activeId) ?? null;
  const isOwner = !!owned.find(l => l.id === activeId);

  return (
    <div className="min-h-screen flex">
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          <ListSidebar activeListId={activeId} onSelect={selectList}
                       onOpenHistory={() => { setDrawerOpen(false); setHistoryOpen(true); }}
                       onClose={() => setDrawerOpen(false)} />
          <div className="flex-1 bg-black/40" onClick={() => setDrawerOpen(false)} />
        </div>
      )}
      <main className="flex-1 flex flex-col">
        <header className="flex items-center justify-between p-3 border-b border-border bg-surface">
          <button className="btn-ghost p-2" onClick={() => setDrawerOpen(true)} aria-label="פתח תפריט">
            <Menu size={20} />
          </button>
          <h1 className="font-semibold truncate">{active?.name ?? '—'}</h1>
          <button className="btn-ghost p-2" disabled={!isOwner} onClick={() => setShareOpen(true)} aria-label="שתף">
            <Share2 size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-hidden">
          {active ? <ActiveList listId={active.id} /> : <div className="p-8 text-center text-muted">טוען רשימות...</div>}
        </div>
      </main>
      {shareOpen && active && <ShareDialog listId={active.id} onClose={() => setShareOpen(false)} />}
      {historyOpen && active && <HistoryView listId={active.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
