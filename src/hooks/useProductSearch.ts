import { useCallback, useEffect, useState } from 'react';
import { db, type SearchProductResult } from '../lib/supabase';

const DEBOUNCE_MS = 200;
const MIN_LEN = 2;

export function useProductSearch(query: string, chainCode = 'shufersal', limit = 8) {
  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_LEN;
  const [fetched, setFetched] = useState<SearchProductResult[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.rpc('search_products', {
      p_query: trimmed,
      p_chain_code: chainCode,
      p_limit: limit,
    });
    setFetched(error ? [] : (data ?? []) as SearchProductResult[]);
    setLoading(false);
  }, [trimmed, chainCode, limit]);

  useEffect(() => {
    if (tooShort) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (!cancelled) void runSearch();
    }, DEBOUNCE_MS);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [tooShort, runSearch]);

  // Derive what we expose so the short-query case never needs a setState reset.
  return {
    results: tooShort ? [] : fetched,
    loading: tooShort ? false : loading,
  };
}
