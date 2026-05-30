import { useState } from 'react';
import { db, type ListType } from '../lib/supabase';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface Props { onCreated: (id: string) => void; onClose: () => void; }

const LIST_TYPES: { type: ListType; icon: string; label: string; desc: string }[] = [
  { type: 'shopping',  icon: '🛒', label: 'קניות',   desc: 'מחלקות ומחירים' },
  { type: 'checklist', icon: '✅', label: 'משימות',  desc: 'רשימה פשוטה'    },
  { type: 'note',      icon: '📝', label: 'פתק',     desc: 'טקסט חופשי'     },
  { type: 'log',       icon: '📋', label: 'יומן',    desc: 'רשומות עם תאריך' },
];

export function NewListDialog({ onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [listType, setListType] = useState<ListType>('shopping');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const { data, error } = await db.rpc('create_list', {
      p_name: name.trim(),
      p_make_default: false,
      p_list_type: listType,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    onCreated(data as string);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      <div className="card w-full max-w-sm p-4">
        <h2 className="text-lg font-semibold mb-4">רשימה חדשה</h2>

        <p className="text-xs text-muted mb-2 font-medium">סוג הרשימה</p>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {LIST_TYPES.map(({ type, icon, label, desc }) => (
            <button
              key={type}
              type="button"
              onClick={() => setListType(type)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition',
                listType === type
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-border bg-panel-2 hover:border-indigo-500/40'
              )}
            >
              <span className="text-2xl leading-none">{icon}</span>
              <span className="text-xs font-semibold">{label}</span>
              <span className="text-[10px] text-muted leading-tight">{desc}</span>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted mb-2 font-medium">שם הרשימה</p>
        <input
          autoFocus
          className="input mb-4"
          placeholder="למשל: קניות שישי"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void create(); }}
        />
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>ביטול</button>
          <button className="btn-primary flex-1" disabled={busy || !name.trim()} onClick={() => void create()}>צור</button>
        </div>
      </div>
    </div>
  );
}
