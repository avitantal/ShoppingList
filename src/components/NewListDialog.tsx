import { useState } from 'react';
import { db } from '../lib/supabase';
import { toast } from 'sonner';

interface Props { onCreated: (id: string) => void; onClose: () => void; }

export function NewListDialog({ onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const { data, error } = await db.rpc('create_list', { p_name: name.trim(), p_make_default: false });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    onCreated(data as string);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      <div className="card w-full max-w-sm p-4">
        <h2 className="text-lg font-semibold mb-3">רשימה חדשה</h2>
        <input autoFocus className="input mb-3" placeholder="שם הרשימה"
               value={name} onChange={e => setName(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>ביטול</button>
          <button className="btn-primary flex-1" disabled={busy} onClick={() => void create()}>צור</button>
        </div>
      </div>
    </div>
  );
}
