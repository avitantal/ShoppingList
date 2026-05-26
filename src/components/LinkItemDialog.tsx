import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
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
  initialQuery: string;
  onPick: (product: SearchProductResult) => void;
  onClose: () => void;
}

export function LinkItemDialog({ initialQuery, onPick, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const { included } = useChainFilter();
  const { results, loading } = useProductSearch(query, included);
  const cheapestKeys = getCheapestProductKeys(results);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2"
         onClick={onClose}>
      <div className="card w-full max-w-md p-4 max-h-[80vh] flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">קישור פריט למוצר</h2>
          <button className="btn-ghost p-1.5" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </div>
        <input className="input mb-2"
               placeholder="חפש מוצר..."
               value={query}
               onChange={e => setQuery(e.target.value)} />
        <ChainFilter className="mb-3" />
        <div className="flex-1 overflow-y-auto -mx-4 px-4">
          {query.trim().length < 2 ? (
            <p className="text-sm text-muted text-center py-6">הקלד לפחות 2 תווים</p>
          ) : loading ? (
            <p className="text-sm text-muted text-center py-6">מחפש...</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">לא נמצאו מוצרים תואמים</p>
          ) : (
            <ul role="listbox">
              {results.map(r => (
                <ProductSuggestionRow
                  key={productSuggestionKey(r)}
                  product={r}
                  cheapest={cheapestKeys.has(productSuggestionKey(r))}
                  onClick={() => onPick(r)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
