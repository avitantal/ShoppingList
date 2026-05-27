import { useCallback, useEffect, useState } from 'react';
import type { DepartmentCode } from '../lib/departments';

// Persists which department sections are collapsed in the active list.
// Sections default to expanded; we only store the set of collapsed codes
// so the localStorage payload stays small.

const STORAGE_KEY = 'shoppinglist-department-collapsed';

function loadFromStorage(): Set<DepartmentCode> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as DepartmentCode[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveToStorage(set: Set<DepartmentCode>) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export function useDepartmentCollapse() {
  const [collapsed, setCollapsed] = useState<Set<DepartmentCode>>(loadFromStorage);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setCollapsed(loadFromStorage());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((code: DepartmentCode) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      saveToStorage(next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
