import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('../../lib/supabase', () => {
  const mock = makeMockClient({ shopping_lists: [] });
  return { supabase: mock, db: mock.schema('shopping'), SHOPPING_SCHEMA: 'shopping' };
});

beforeEach(() => vi.clearAllMocks());

describe('useDepartmentOrder', () => {
  it('returns empty orderMap when initialOrder is null', async () => {
    const { useDepartmentOrder } = await import('../../hooks/useDepartmentOrder');
    const { result } = renderHook(() => useDepartmentOrder('L1', null));
    expect(result.current.orderMap.size).toBe(0);
  });

  it('builds orderMap from initial order array', async () => {
    const { useDepartmentOrder } = await import('../../hooks/useDepartmentOrder');
    const { result } = renderHook(() =>
      useDepartmentOrder('L1', ['dairy', 'produce', 'bakery'] as any),
    );
    expect(result.current.orderMap.get('dairy')).toBe(0);
    expect(result.current.orderMap.get('produce')).toBe(1);
    expect(result.current.orderMap.get('bakery')).toBe(2);
  });

  it('reorder updates orderMap immediately (optimistic)', async () => {
    const { useDepartmentOrder } = await import('../../hooks/useDepartmentOrder');
    const { result } = renderHook(() =>
      useDepartmentOrder('L1', ['dairy', 'produce'] as any),
    );
    act(() => {
      result.current.reorder(['produce', 'dairy'] as any);
    });
    expect(result.current.orderMap.get('produce')).toBe(0);
    expect(result.current.orderMap.get('dairy')).toBe(1);
  });
});
