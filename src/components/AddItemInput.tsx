import { Plus } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useProductSearch } from '../hooks/useProductSearch';
import { CHAIN_BADGE_COLORS } from '../lib/supabase';

interface Props {
  onAdd: (name: string, barcode?: string) => Promise<void> | void;
}

const BADGE_FALLBACK = { bg: '#6B7280', fg: '#FFFFFF' };

// Shufersal publishes unit_measure as a comparison-unit string ("100 גרם",
// "1ליטר") rather than the bare unit. Concatenating unit_qty in front of it
// produces nonsense like "2 1ליטר". Strip any leading digit prefix so the
// label reads naturally: "2 ליטר", "250 גרם".
function formatPackageSize(qty: number | null, measure: string | null): string {
  if (qty == null || !measure) return '';
  const unitWord = measure.replace(/^\s*\d+(\.\d+)?\s*/, '').trim();
  if (!unitWord) return '';
  return `${qty} ${unitWord} · `;
}

export function AddItemInput({ onAdd }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const { results } = useProductSearch(name);

  async function add(value: string, barcode?: string) {
    if (!value) return;
    setBusy(true);
    try {
      await onAdd(value, barcode);
      setName('');
      setOpen(false);
    } finally { setBusy(false); }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (open && results[highlighted]) {
      const r = results[highlighted];
      void add(r.name, r.barcode);
    } else {
      void add(name.trim());
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(i => Math.max(i - 1, 0)); }
  }

  return (
    <form onSubmit={submit} className="relative">
      <div className="flex items-center gap-2 p-2 border-b border-border bg-surface">
        <button type="submit" disabled={busy || !name.trim()} className="btn-ghost p-2" aria-label="הוסף פריט">
          <Plus size={18} />
        </button>
        <input
          value={name}
          onChange={e => { setName(e.target.value); setOpen(true); setHighlighted(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          placeholder="הוסף פריט..."
          className="input flex-1"
          aria-autocomplete="list"
        />
      </div>
      {open && results.length > 0 && (
        <ul
          className="absolute right-0 left-0 top-full z-20 bg-surface border border-border rounded-b-md shadow-md max-h-80 overflow-y-auto"
          role="listbox"
        >
          {results.map((r, i) => {
            const badge = CHAIN_BADGE_COLORS[r.chain_code] ?? BADGE_FALLBACK;
            return (
              <li
                key={r.barcode}
                role="option"
                aria-selected={i === highlighted}
                onMouseEnter={() => setHighlighted(i)}
                onMouseDown={(e) => { e.preventDefault(); void add(r.name, r.barcode); }}
                className={`px-3 py-2 cursor-pointer text-sm ${i === highlighted ? 'bg-muted' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{r.name}</div>
                  <span
                    className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: badge.bg, color: badge.fg }}
                  >
                    {r.chain_display_name}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatPackageSize(r.unit_qty, r.unit_measure)}
                  ₪{r.price.toFixed(2)}
                  {r.manufacturer ? ` · ${r.manufacturer}` : ''}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
