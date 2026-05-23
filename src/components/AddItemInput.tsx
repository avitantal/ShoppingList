import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

interface Props { onAdd: (name: string) => Promise<void> | void; }

export function AddItemInput({ onAdd }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    setBusy(true);
    await onAdd(v);
    setName('');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 p-2 border-b border-border bg-surface">
      <button type="submit" disabled={busy || !name.trim()} className="btn-ghost p-2" aria-label="הוסף פריט">
        <Plus size={18} />
      </button>
      <input value={name} onChange={e => setName(e.target.value)}
             placeholder="הוסף פריט..." className="input flex-1" />
    </form>
  );
}
