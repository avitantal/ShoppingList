import { useCallback, useEffect, useState } from 'react';
import { db } from '../lib/supabase';

// Shared, persisted "which chains is the user interested in" state.
// `excluded` is the set the user has toggled OFF; everything not in it
// counts as included. We persist the negative form so brand-new chains
// (added server-side later) light up by default instead of staying dark.

const LS_KEY = 'chainFilter.excluded';

interface Chain { code: string; display_name: string }

function readExcluded(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch { return new Set(); }
}

function writeExcluded(set: Set<string>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

// Hoisted module-level state so every consumer sees the same toggles
// without a context provider. Trivial pub-sub.
const listeners = new Set<() => void>();
let excluded = readExcluded();
function emit() { listeners.forEach(l => l()); }

export function useChainFilter() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await db.from('chains').select('code, display_name').order('code');
      if (cancelled) return;
      setChains((data ?? []) as Chain[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback((code: string) => {
    excluded = new Set(excluded);
    if (excluded.has(code)) excluded.delete(code); else excluded.add(code);
    writeExcluded(excluded);
    emit();
  }, []);

  const included = chains.filter(c => !excluded.has(c.code)).map(c => c.code);

  return { chains, excluded, included, toggle };
}
