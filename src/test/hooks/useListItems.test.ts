import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

vi.mock('../../lib/supabase', () => {
  const mock = makeMockClient({
    list_items: [
      { id: 'I1', list_id: 'L1', name: 'חלב 3%', qty: 1, unit: 'ליטר', notes: null, estimated_price: 6.90, is_in_cart: false, sort_order: 0, created_by: 'u1', last_purchased_at: null, created_at: 't', updated_at: 't' },
      { id: 'I2', list_id: 'L1', name: 'לחם',   qty: 1, unit: null,    notes: null, estimated_price: 7.00, is_in_cart: true,  sort_order: 1, created_by: 'u1', last_purchased_at: null, created_at: 't', updated_at: 't' },
    ],
  });
  return { supabase: mock, db: mock.schema('shopping'), SHOPPING_SCHEMA: 'shopping' };
});

describe('useListItems', () => {
  it('returns items for the given list', async () => {
    const { useListItems } = await import('../../hooks/useListItems');
    const { result } = renderHook(() => useListItems('L1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.find(i => i.id === 'I2')?.is_in_cart).toBe(true);
  });
});
