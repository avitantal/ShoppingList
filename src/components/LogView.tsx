import { useState } from 'react';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useListItems } from '../hooks/useListItems';
import { SimpleAddInput } from './SimpleAddInput';
import type { ShoppingList } from '../lib/supabase';

interface Props { list: ShoppingList; }

function formatTs(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} · ${hh}:${min}`;
}

export function LogView({ list }: Props) {
  const { items, addItem, updateItem, deleteItem, restoreItem } = useListItems(list.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const sorted = [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  function startEdit(id: string, name: string) {
    setEditingId(id);
    setEditText(name);
  }

  async function commitEdit(id: string) {
    const text = editText.trim();
    if (text) await updateItem(id, { name: text });
    setEditingId(null);
  }

  function deleteWithUndo(item: typeof items[0]) {
    const deletion = deleteItem(item.id);
    toast(`נמחק: ${item.name}`, {
      duration: 7000,
      action: { label: 'בטל', onClick: () => void deletion.then(() => restoreItem(item)) },
    });
    void deletion.catch(() => toast.error('מחיקה נכשלה'));
  }

  return (
    <div className="flex flex-col h-full">
      <SimpleAddInput placeholder="הוסף רשומה..." onAdd={text => void addItem(text)} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.length === 0 && (
          <div className="text-center text-muted p-8 text-sm">אין רשומות עדיין</div>
        )}
        {sorted.map(item => (
          <div key={item.id} className="flex items-start gap-3 px-4 py-3 border-b border-border group">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-muted tabular-nums mb-1">{formatTs(item.created_at)}</div>
              {editingId === item.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="input flex-1 text-sm py-1"
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void commitEdit(item.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <button onClick={() => void commitEdit(item.id)} className="text-emerald-400 hover:text-emerald-300 p-1" aria-label="שמור"><Check size={14} /></button>
                  <button onClick={() => setEditingId(null)} className="text-muted hover:text-text p-1" aria-label="בטל"><X size={14} /></button>
                </div>
              ) : (
                <p className="text-sm break-words">{item.name}</p>
              )}
            </div>
            {editingId !== item.id && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-4">
                <button onClick={() => startEdit(item.id, item.name)} className="text-muted hover:text-text p-1" aria-label="ערוך"><Pencil size={13} /></button>
                <button onClick={() => deleteWithUndo(item)} className="text-muted hover:text-red-400 p-1" aria-label="מחק"><Trash2 size={13} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
