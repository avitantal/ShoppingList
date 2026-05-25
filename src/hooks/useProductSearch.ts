import { useEffect, useMemo, useState } from 'react';
import { db, type SearchProductResult } from '../lib/supabase';

const DEBOUNCE_MS = 200;
const MIN_LEN = 2;

interface SearchState {
  results: SearchProductResult[];
  loading: boolean;
  resolvedQuery: string;
  requestKey: string;
}

function buildQueryAttempts(query: string, autoFallback: boolean): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const attempts: string[] = [];

  while (words.length > 0) {
    const candidate = words.join(' ');
    if (candidate.length >= MIN_LEN && !attempts.includes(candidate)) {
      attempts.push(candidate);
    }
    if (!autoFallback || words.length <= 1) break;
    words.pop();
  }

  return attempts;
}

// includedChains:
//   undefined → server default (all chains)
//   string[]  → only those chains
// We join the array into a stable key for the effect deps; passing the
// array directly would re-run the search on every parent render.
export function useProductSearch(
  query: string,
  includedChains?: readonly string[],
  limit = 16,
  autoFallback = true,
) {
  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_LEN;
  const chainsKey = includedChains ? [...includedChains].sort().join(',') : '';
  const chainsArg = useMemo(
    () => (includedChains && includedChains.length > 0 ? [...includedChains] : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainsKey],
  );

  // When the user disables all chains we want to show "no results" rather
  // than the unfiltered default — easier to reason about than treating
  // empty array as "everything".
  const allDisabled = includedChains?.length === 0;
  const requestKey = `${trimmed}\u0000${chainsKey}\u0000${limit}\u0000${autoFallback}`;

  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    resolvedQuery: '',
    requestKey: '',
  });

  useEffect(() => {
    if (tooShort || allDisabled) {
      setState({ results: [], loading: false, resolvedQuery: '', requestKey });
      return;
    }

    let cancelled = false;
    setState({ results: [], loading: true, resolvedQuery: '', requestKey });

    const t = window.setTimeout(() => {
      void (async () => {
        const attempts = buildQueryAttempts(trimmed, autoFallback);
        for (const attempt of attempts) {
          if (cancelled) return;

          let rows: SearchProductResult[] = [];
          try {
            const { data, error } = await db.rpc('search_products', {
              p_query: attempt,
              p_chain_codes: chainsArg,
              p_limit: limit,
            });
            rows = error ? [] : (data ?? []) as SearchProductResult[];
          } catch {
            rows = [];
          }

          if (cancelled) return;
          if (rows.length > 0 || attempt === attempts[attempts.length - 1]) {
            setState({ results: rows, loading: false, resolvedQuery: attempt, requestKey });
            return;
          }
        }

        setState({ results: [], loading: false, resolvedQuery: '', requestKey });
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [allDisabled, autoFallback, chainsArg, chainsKey, limit, requestKey, tooShort, trimmed]);

  return {
    results: tooShort || allDisabled || state.requestKey !== requestKey ? [] : state.results,
    loading: tooShort || allDisabled ? false : state.loading && state.requestKey === requestKey,
    resolvedQuery: state.requestKey === requestKey ? state.resolvedQuery : '',
  };
}
