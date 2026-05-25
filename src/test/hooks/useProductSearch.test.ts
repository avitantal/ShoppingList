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
      p_chain_codes: null,
      p_limit: 16,
    });
  });

  it('falls back by dropping the last word until results are found', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ barcode: '1', name: 'חלב תנובה 3%', unit_qty: 1, unit_measure: 'ליטר', manufacturer: 'תנובה', price: 6.9, chain_code: 'shufersal', chain_display_name: 'שופרסל' }],
        error: null,
      });

    const { result } = renderHook(() => useProductSearch('חלב תנובה 3% 1 ליטר'));
    act(() => { vi.advanceTimersByTime(201); });

    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.resolvedQuery).toBe('חלב תנובה 3%');
    expect(rpcMock.mock.calls.map(call => call[1].p_query)).toEqual([
      'חלב תנובה 3% 1 ליטר',
      'חלב תנובה 3% 1',
      'חלב תנובה 3%',
    ]);
  });

  it('exposes returned rows as results', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ barcode: '1', name: 'חלב', unit_qty: 1, unit_measure: 'ליטר', manufacturer: 'תנובה', price: 6.9, chain_code: 'shufersal', chain_display_name: 'שופרסל' }],
      error: null,
    });
    const { result } = renderHook(() => useProductSearch('חלב'));
    act(() => { vi.advanceTimersByTime(201); });
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.results[0].barcode).toBe('1');
  });
});
