import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/supabase';
import type { CatalogIndex } from '../lib/departmentLookup';
import type { DepartmentCode } from '../lib/departments';

// Bulk-fetches department assignments for a set of barcodes from
// shopping.product_departments. The result is keyed by barcode so
// callers can hand it straight to getDepartmentForItem.

export function useProductDepartments(barcodes: string[]): CatalogIndex {
  const dedupedKey = useMemo(() => {
    const set = new Set<string>();
    for (const b of barcodes) if (b) set.add(b);
    return [...set].sort().join(',');
  }, [barcodes]);

  const [map, setMap] = useState<CatalogIndex>(() => new Map());

  useEffect(() => {
    if (!dedupedKey) {
      setMap((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    let cancelled = false;
    const ids = dedupedKey.split(',');

    (async () => {
      const { data, error } = await db
        .from('product_departments')
        .select('barcode,department_code')
        .in('barcode', ids);
      if (cancelled) return;
      if (error || !data) {
        setMap(new Map());
        return;
      }
      const next = new Map<string, DepartmentCode>();
      for (const row of data as Array<{ barcode: string; department_code: string }>) {
        next.set(row.barcode, row.department_code as DepartmentCode);
      }
      setMap(next);
    })();

    return () => { cancelled = true; };
  }, [dedupedKey]);

  return map;
}
