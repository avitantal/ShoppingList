import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { db } from '../lib/supabase';
import type { DepartmentCode } from '../lib/departments';

export function useDepartmentOrder(
  listId: string,
  initialOrder: DepartmentCode[] | null,
) {
  const [order, setOrder] = useState<DepartmentCode[] | null>(initialOrder);

  const orderMap = useMemo(
    () => new Map((order ?? []).map((code, i) => [code, i] as [DepartmentCode, number])),
    [order],
  );

  const reorder = useCallback(
    (newCodes: DepartmentCode[]) => {
      const prev = order;
      setOrder(newCodes);
      void db
        .from('shopping_lists')
        .update({ department_order: newCodes })
        .eq('id', listId)
        .then(({ error }: { error: Error | null }) => {
          if (error) {
            setOrder(prev);
            toast.error('שמירת הסדר נכשלה');
          }
        });
    },
    [listId, order],
  );

  return { orderMap, reorder };
}
