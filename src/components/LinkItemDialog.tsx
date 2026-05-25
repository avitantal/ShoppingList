import { useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import { useProductSearch } from '../hooks/useProductSearch';
import { useChainFilter } from '../hooks/useChainFilter';
import { ChainFilter } from './ChainFilter';
import { CHAIN_BADGE_COLORS, type SearchProductResult } from '../lib/supabase';

interface Props {
  initialQuery: string;
  onPick: (product: SearchProductResult) => void;
  onClose: () => void;
}

const BADGE_FALLBACK = { bg: '#6B7280', fg: '#FFFFFF' };

function formatPackageSize(qty: number | null, measure: string | null): string {
  if (qty == null || !measure) return '';
  const unitWord = measure.replace(/^\s*\d+(\.\d+)?\s*/, '').trim();
  if (!unitWord) return '';
  return `${qty} ${unitWord} · `;
}

export function LinkItemDialog({ initialQuery, onPick, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  // Track whether the user has manually typed in the search box. Until
  // then, an empty result set with a multi-word query auto-trims the
  // last word and retries — so "חלב 3% תנובה 1 ליטר" gracefully falls
  // back to "חלב 3%" → "חלב" instead of dead-ending.
  const [userEdited, setUserEdited] = useState(false);
  const { included } = useChainFilter();
  const { results, loading } = useProductSearch(query, included);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (userEdited || loading) return;
    if (results.length > 0) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const words = trimmed.split(/\s+/);
    if (words.length <= 1) return;
    words.pop();
    setQuery(words.join(' '));
  }, [userEdited, loading, results, query]);

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
               onChange={e => { setUserEdited(true); setQuery(e.target.value); }} />
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
              {results.map(r => {
                const badge = CHAIN_BADGE_COLORS[r.chain_code] ?? BADGE_FALLBACK;
                return (
                  <li key={r.barcode} role="option"
                      onClick={() => onPick(r)}
                      className="px-3 py-2 cursor-pointer text-sm hover:bg-bg rounded-md border-b border-border last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium truncate flex items-center gap-1.5">
                        {r.previously_bought && (
                          <Star size={12} className="shrink-0 text-amber-400 fill-amber-400" aria-label="נקנה בעבר" />
                        )}
                        <span className="truncate">{r.name}</span>
                      </div>
                      <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: badge.bg, color: badge.fg }}>
                        {r.chain_display_name}
                      </span>
                    </div>
                    {r.manufacturer && (
                      <div className="text-xs text-foreground/80 font-medium truncate mt-0.5">
                        {r.manufacturer}
                      </div>
                    )}
                    <div className="text-xs text-muted">
                      {formatPackageSize(r.unit_qty, r.unit_measure)}
                      ₪{r.price.toFixed(2)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
