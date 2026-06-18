import { useEffect, useRef, useState } from 'react';
import { db, type ShoppingList } from '../lib/supabase';
import { toast } from 'sonner';

interface Props { list: ShoppingList; }

const DEBOUNCE_MS = 800;

export function NoteView({ list }: Props) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const itemIdRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await db.from('list_items').select('id, name').eq('list_id', list.id).limit(1).maybeSingle();
      if (data) {
        itemIdRef.current = data.id;
        setText(data.name);
      }
      setLoaded(true);
    })();
  }, [list.id]);

  function handleChange(val: string) {
    setText(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(val), DEBOUNCE_MS);
  }

  async function save(val: string) {
    if (itemIdRef.current) {
      await db.from('list_items').update({ name: val }).eq('id', itemIdRef.current);
    } else {
      const { data, error } = await db.from('list_items').insert({
        list_id: list.id,
        name: val,
        qty: 1,
      }).select('id').single();
      if (error) { toast.error('שמירה נכשלה'); return; }
      itemIdRef.current = data.id;
    }
  }

  if (!loaded) return null;

  return (
    <div className="flex flex-col h-full p-3">
      <textarea
        autoFocus
        className="flex-1 min-h-0 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted/50"
        placeholder="כתוב כאן..."
        value={text}
        onChange={e => handleChange(e.target.value)}
      />
    </div>
  );
}
