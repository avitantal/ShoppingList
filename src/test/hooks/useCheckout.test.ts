import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { makeMockClient } from '../helpers/mockSupabase';

const rpcSpy = vi.fn(() => 'EVT1');
vi.mock('../../lib/supabase', () => ({
  supabase: makeMockClient({}, { complete_checkout: rpcSpy }),
}));

describe('useCheckout', () => {
  it('calls complete_checkout RPC with normalized payload', async () => {
    const { useCheckout } = await import('../../hooks/useCheckout');
    const { result } = renderHook(() => useCheckout('L1'));
    await act(async () => {
      await result.current.checkout({
        storeChain: '  שופרסל  ',
        storeBranch: 'גבעתיים',
        items: [{ list_item_id: 'I1', name: 'חלב', qty: 1, unit_price: 6.9 }],
      });
    });
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const arg = (rpcSpy.mock.calls[0] as unknown[])[0] as { p_store_chain: string };
    expect(arg.p_store_chain).toBe('שופרסל');
  });
});
