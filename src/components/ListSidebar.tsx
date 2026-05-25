import { useState } from 'react';
import { Plus, History, ChevronLeft, Trash2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useLists } from '../hooks/useLists';
import { useAuth } from '../hooks/useAuth';
import { NewListDialog } from './NewListDialog';
import { db } from '../lib/supabase';
import { signOut } from '../lib/googleAuth';
import { cn } from '../lib/utils';

interface Props {
  activeListId: string | null;
  onSelect: (id: string) => void;
  onOpenHistory: () => void;
  onClose: () => void;
}

export function ListSidebar({ activeListId, onSelect, onOpenHistory, onClose }: Props) {
  const { owned, shared, refresh } = useLists();
  const { session } = useAuth();
  const [creating, setCreating] = useState(false);
  const email = session?.user?.email ?? '';

  async function archive(listId: string, name: string) {
    if (!window.confirm(`למחוק את "${name}"?`)) return;
    const { error } = await db.rpc('archive_list', { p_list_id: listId });
    if (error) { toast.error(error.message); return; }
    toast.success('הרשימה נמחקה');
    void refresh();
  }

  async function doSignOut() {
    if (!window.confirm('להתנתק?')) return;
    await signOut();
  }

  return (
    <aside className="w-72 bg-surface border-l border-border h-full flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="font-semibold">הרשימות שלי</h2>
        <button className="btn-ghost p-2" onClick={onClose} aria-label="סגור"><ChevronLeft size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <section className="p-2">
          <ul>
            {owned.map(l => (
              <li key={l.id} className="group flex items-center gap-1">
                <button className={cn('flex-1 text-right px-3 py-2 rounded-lg text-sm',
                                      activeListId === l.id ? 'bg-accent text-white' : 'hover:bg-bg')}
                        onClick={() => onSelect(l.id)}>
                  {l.name}{l.is_default && <span className="text-xs text-muted mr-2">(ברירת מחדל)</span>}
                </button>
                {!l.is_default && (
                  <button onClick={() => void archive(l.id, l.name)}
                          className="btn-ghost p-1.5 text-muted hover:text-red-400 opacity-60 hover:opacity-100"
                          aria-label={`מחק את ${l.name}`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button className="btn-ghost w-full mt-2 gap-2" onClick={() => setCreating(true)}>
            <Plus size={16} /> רשימה חדשה
          </button>
        </section>
        {shared.length > 0 && (
          <section className="p-2 border-t border-border">
            <h3 className="text-xs text-muted px-3 mb-2">ששותפו איתי</h3>
            <ul>
              {shared.map(l => (
                <li key={l.id}>
                  <button className={cn('w-full text-right px-3 py-2 rounded-lg text-sm',
                                        activeListId === l.id ? 'bg-accent text-white' : 'hover:bg-bg')}
                          onClick={() => onSelect(l.id)}>{l.name}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="p-2 border-t border-border">
        <button className="btn-ghost w-full gap-2" onClick={onOpenHistory}>
          <History size={16} /> היסטוריית קניות
        </button>
      </div>
      <div className="p-2 border-t border-border">
        {email && (
          <div className="px-3 py-1 text-xs text-muted truncate" title={email}>
            {email}
          </div>
        )}
        <button className="btn-ghost w-full gap-2 text-muted hover:text-red-400"
                onClick={() => void doSignOut()}>
          <LogOut size={16} /> התנתק / החלף משתמש
        </button>
      </div>
      {creating && (
        <NewListDialog onClose={() => setCreating(false)}
                       onCreated={(id) => { setCreating(false); void refresh(); onSelect(id); }} />
      )}
    </aside>
  );
}
