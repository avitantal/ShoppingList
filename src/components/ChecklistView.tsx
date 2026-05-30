import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useListItems } from '../hooks/useListItems';
import { SimpleAddInput } from './SimpleAddInput';
import type { ShoppingList } from '../lib/supabase';
import { cn } from '../lib/utils';

interface Props { list: ShoppingList; }

export function ChecklistView({ list }: Props) {
  const { items, addItem, setInCart, deleteItem, restoreItem } = useListItems(list.id);

  const unchecked = useMemo(() => items.filter(i => !i.is_in_cart), [items]);
  const checked   = useMemo(() => items.filter(i =>  i.is_in_cart), [items]);

  function deleteWithUndo(item: typeof items[0]) {
    const deletion = deleteItem(item.id);
    toast(`נמחק ${item.name}`, {
      duration: 7000,
      action: { label: 'בטל', onClick: () => void deletion.then(() => restoreItem(item)) },
    });
    void deletion.catch(() => toast.error('מחיקת הפריט נכשלה'));
  }

  function clearChecked() {
    const toDelete = items.filter(i => i.is_in_cart);
    toDelete.forEach(i => void deleteItem(i.id).catch(() => undefined));
    toast(`נמחקו ${toDelete.length} פריטים מסומנים`);
  }

  return (
    <div className="flex flex-col h-full">
      <SimpleAddInput placeholder="הוסף משימה..." onAdd={name => void addItem(name)} />
      <div className="flex-1 overflow-y-auto">
        {unchecked.length === 0 && checked.length === 0 && (
          <div className="text-center text-muted p-8 text-sm">הרשימה ריקה — הוסף משימה ראשונה</div>
        )}
        {unchecked.map(item => (
          <Row key={item.id} item={item} onToggle={() => void setInCart(item.id, true)} onDelete={() => deleteWithUndo(item)} />
        ))}
        {checked.length > 0 && (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-t border-border">
              <span className="text-xs text-muted font-medium">הושלמו ({checked.length})</span>
              <button className="text-xs text-muted hover:text-red-400 transition-colors" onClick={clearChecked}>
                נקה הכל
              </button>
            </div>
            {checked.map(item => (
              <Row key={item.id} item={item} onToggle={() => void setInCart(item.id, false)} onDelete={() => deleteWithUndo(item)} checked />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ item, onToggle, onDelete, checked = false }: {
  item: { id: string; name: string };
  onToggle: () => void;
  onDelete: () => void;
  checked?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 border-b border-border',
      checked && 'bg-emerald-500/5'
    )}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-5 h-5 accent-indigo-500 shrink-0"
      />
      <span className={cn('flex-1 text-sm', checked && 'line-through text-muted')}>{item.name}</span>
      <button
        type="button"
        onClick={onDelete}
        className="text-muted/40 hover:text-red-400 transition-colors p-1"
        aria-label="מחק"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
