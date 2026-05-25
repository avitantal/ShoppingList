import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductSearch } from '../../hooks/useProductSearch';

const rpcMock = vi.fn();

vi.mock('../../lib/supabase', () => ({
  db: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('useProductSearch', () => {
  it('does not call RPC for queries shorter than 2 chars', () => {
    const { result } = renderHook(() => useProductSearch(''));
    expect(result.current.results).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('debounces and calls search_products with trimmed query', async () => {
    const { rerender } = renderHook(({ q }) => useProductSearch(q), {
      initialProps: { q: '' },
    });
    rerender({ q: 'ח' });
    rerender({ q: 'חל' });
    rerender({ q: 'חלב ' });
    act(() => { vi.advanceTimersByTime(199); });
    expect(rpcMock).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('search_products', {
      p_query: 'חלב',
      p_chain_code: 'shufersal',
      p_limit: 8,
    });
  });

  it('exposes returned rows as results', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ barcode: '1', name: 'חלב', unit_qty: 1, unit_measure: 'ליטר', manufacturer: 'תנובה', price: 6.9 }],
      error: null,
    });
    const { result } = renderHook(() => useProductSearch('חלב'));
    act(() => { vi.advanceTimersByTime(201); });
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.results[0].barcode).toBe('1');
  });
});
