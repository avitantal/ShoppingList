import { useEffect, useState } from 'react';
import { db, type SearchProductResult } from '../lib/supabase';

const DEBOUNCE_MS = 200;
const MIN_LEN = 2;

export function useProductSearch(query: string, chainCode = 'shufersal', limit = 8) {
  const [results, setResults] = useState<SearchProductResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_LEN) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const { data, error } = await db.rpc('search_products', {
        p_query: trimmed,
        p_chain_code: chainCode,
        p_limit: limit,
      });
      if (cancelled) return;
      setResults(error ? [] : (data ?? []) as SearchProductResult[]);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => { cancelled = true; window.clearTimeout(t); };
  }, [query, chainCode, limit]);

  return { results, loading };
}
