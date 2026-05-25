import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, type SearchProductResult } from '../lib/supabase';

const DEBOUNCE_MS = 200;
const MIN_LEN = 2;

// includedChains:
//   undefined → server default (all chains)
//   string[]  → only those chains
// We join the array into a stable key for the effect deps; passing the
// array directly would re-run the search on every parent render.
export function useProductSearch(query: string, includedChains?: readonly string[], limit = 16) {
  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_LEN;
  const chainsKey = includedChains ? [...includedChains].sort().join(',') : '';
  const chainsArg = useMemo(
    () => (includedChains && includedChains.length > 0 ? [...includedChains] : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainsKey],
  );

  const [fetched, setFetched] = useState<SearchProductResult[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.rpc('search_products', {
      p_query: trimmed,
      p_chain_codes: chainsArg,
      p_limit: limit,
    });
    setFetched(error ? [] : (data ?? []) as SearchProductResult[]);
    setLoading(false);
  }, [trimmed, chainsArg, limit]);

  useEffect(() => {
    if (tooShort) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (!cancelled) void runSearch();
    }, DEBOUNCE_MS);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [tooShort, runSearch]);

  // When the user disables all chains we want to show "no results" rather
  // than the unfiltered default — easier to reason about than treating
  // empty array as "everything".
  const allDisabled = includedChains?.length === 0;

  return {
    results: tooShort || allDisabled ? [] : fetched,
    loading: tooShort || allDisabled ? false : loading,
  };
}
