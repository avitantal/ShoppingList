import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase, type ListParticipant } from '../lib/supabase';
import { toast } from 'sonner';

interface Props { listId: string; onClose: () => void; }

export function ShareDialog({ listId, onClose }: Props) {
  const [participants, setParticipants] = useState<ListParticipant[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('v_list_participants').select('*').eq('list_id', listId);
    setParticipants((data ?? []) as ListParticipant[]);
  }, [listId]);

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  async function invite() {
    const v = email.trim();
    if (!v) return;
    setBusy(true);
    const { error } = await supabase.rpc('share_list', { p_list_id: listId, p_email: v, p_role: 'editor' });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setEmail('');
    toast.success('הוזמן');
    void refresh();
  }

  async function remove(p: ListParticipant) {
    if (p.role === 'owner') return;
    const { error } = await supabase.rpc('unshare_list', { p_list_id: listId, p_email: p.email });
    if (error) { toast.error(error.message); return; }
    void refresh();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      <div className="card w-full max-w-md p-4">
        <h2 className="text-lg font-semibold mb-3">שיתוף רשימה</h2>
        <div className="flex gap-2 mb-3">
          <input className="input flex-1" type="email" placeholder="someone@gmail.com"
                 value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn-primary" disabled={busy || !email.trim()} onClick={() => void invite()}>
            הזמן
          </button>
        </div>
        <ul className="border border-border rounded-lg divide-y divide-border">
          {participants.map(p => (
            <li key={p.email} className="flex items-center justify-between px-3 py-2">
              <div>
                <div className="text-sm">{p.email}</div>
                <div className="text-xs text-muted">
                  {p.role === 'owner' ? 'בעלים' : p.joined_at ? 'הצטרף' : 'ממתין'}
                </div>
              </div>
              {p.role !== 'owner' && (
                <button onClick={() => void remove(p)} className="text-muted hover:text-red-400" aria-label="הסר">
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 text-right">
          <button className="btn-ghost" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}
