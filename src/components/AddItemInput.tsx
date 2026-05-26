import { Plus } from 'lucide-react';
import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useProductSearch } from '../hooks/useProductSearch';
import { useChainFilter } from '../hooks/useChainFilter';
import { ChainFilter } from './ChainFilter';
import type { SearchProductResult } from '../lib/supabase';
import {
  getCheapestProductKeys,
  ProductSuggestionRow,
  productSuggestionKey,
} from './ProductSuggestionRow';

interface Props {
  onAdd: (
    name: string,
    barcode: string | undefined,
    suggestion: SearchProductResult | null
  ) => Promise<void> | void;
}

export function AddItemInput({ onAdd }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const { included } = useChainFilter();
  const { results } = useProductSearch(name, included);
  const cheapestKeys = useMemo(() => getCheapestProductKeys(results), [results]);

  async function add(value: string, barcode: string | undefined, suggestion: SearchProductResult | null = null) {
    if (!value) return;
    setBusy(true);
    try {
      await onAdd(value, barcode, suggestion);
      setName('');
      setOpen(false);
    } finally { setBusy(false); }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (open && results[highlighted]) {
      const r = results[highlighted];
      void add(r.name, r.barcode, null);
    } else {
      // Free-text submit: surface the best catalog match (if any) so the
      // parent can offer a one-click swap toast.
      const typed = name.trim();
      const suggestion = pickSuggestion(typed, results);
      void add(typed, undefined, suggestion);
    }
  }

  function pickSuggestion(typed: string, list: SearchProductResult[]): SearchProductResult | null {
    if (!typed || list.length === 0) return null;
    const t = typed.toLowerCase();
    const hit = list.find(r => r.name.toLowerCase().includes(t));
    return hit ?? list[0];
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(i => Math.max(i - 1, 0)); }
  }

  return (
    <form onSubmit={submit} className="relative">
      <div className="flex flex-col gap-1 p-2 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
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
        <ChainFilter className="px-1" />
      </div>
      {open && results.length > 0 && (
        <ul
          className="absolute right-0 left-0 top-full z-20 bg-surface border border-border rounded-b-md shadow-md max-h-80 overflow-y-auto"
          role="listbox"
        >
          {results.map((r, i) => (
            <ProductSuggestionRow
              key={productSuggestionKey(r)}
              product={r}
              highlighted={i === highlighted}
              cheapest={cheapestKeys.has(productSuggestionKey(r))}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => { e.preventDefault(); void add(r.name, r.barcode, null); }}
            />
          ))}
        </ul>
      )}
    </form>
  );
}
