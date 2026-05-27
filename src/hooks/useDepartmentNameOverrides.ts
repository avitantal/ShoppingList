import { useCallback, useEffect, useState } from 'react';
import { normalizeItemName, type DepartmentCode } from '../lib/departments';
import type { NameOverrides } from '../lib/departmentLookup';

// Per-device overrides for free-text items that don't have a barcode.
// Barcode items go through shopping.set_department_override, which is
// shared across users; this localStorage map handles the remainder.

const STORAGE_KEY = 'shoppinglist-department-name-overrides';

function loadFromStorage(): NameOverrides {
  if (typeof window === 'undefined' || !window.localStorage) return new Map();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed) as Array<[string, DepartmentCode]>);
  } catch {
    return new Map();
  }
}

function saveToStorage(map: NameOverrides) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const obj: Record<string, string> = {};
  for (const [k, v] of map) obj[k] = v;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

export function useDepartmentNameOverrides() {
  const [overrides, setOverrides] = useState<NameOverrides>(loadFromStorage);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setOverrides(loadFromStorage());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setOverride = useCallback((name: string, departmentCode: DepartmentCode) => {
    const key = normalizeItemName(name);
    if (!key) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, departmentCode);
      saveToStorage(next);
      return next;
    });
  }, []);

  return { overrides, setOverride };
}
