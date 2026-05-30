import { useState } from 'react';
import { Plus } from 'lucide-react';

interface Props {
  placeholder?: string;
  onAdd: (text: string) => void;
}

export function SimpleAddInput({ placeholder = 'הוסף פריט...', onAdd }: Props) {
  const [value, setValue] = useState('');

  function submit() {
    const text = value.trim();
    if (!text) return;
    onAdd(text);
    setValue('');
  }

  return (
    <div className="flex items-center gap-2 p-3 border-b border-border bg-surface">
      <input
        className="input flex-1"
        placeholder={placeholder}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!value.trim()}
        className="btn-primary w-10 h-10 p-0 shrink-0 disabled:opacity-40"
        aria-label="הוסף"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
