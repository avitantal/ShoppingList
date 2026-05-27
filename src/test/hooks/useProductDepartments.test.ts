import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductDepartments } from '../../hooks/useProductDepartments';

const inMock = vi.fn();
const selectMock = vi.fn((..._args: unknown[]) => ({ in: inMock }));
const fromMock = vi.fn((..._args: unknown[]) => ({ select: selectMock }));

vi.mock('../../lib/supabase', () => ({
  db: {
    from: (table: string) => fromMock(table),
  },
}));

beforeEach(() => {
  fromMock.mockClear();
  selectMock.mockClear();
  inMock.mockReset();
  inMock.mockResolvedValue({ data: [], error: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useProductDepartments', () => {
  it('returns an empty map and skips fetch when barcodes is empty', () => {
    const { result } = renderHook(() => useProductDepartments([]));
    expect(result.current.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('fetches department rows for the given barcodes', async () => {
    inMock.mockResolvedValueOnce({
      data: [
        { barcode: '111', department_code: 'dairy' },
        { barcode: '222', department_code: 'snacks' },
      ],
      error: null,
    });
    const { result } = renderHook(() => useProductDepartments(['111', '222']));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get('111')).toBe('dairy');
    expect(result.current.get('222')).toBe('snacks');
    expect(fromMock).toHaveBeenCalledWith('product_departments');
    expect(selectMock).toHaveBeenCalledWith('barcode,department_code');
    expect(inMock).toHaveBeenCalledWith('barcode', ['111', '222']);
  });

  it('deduplicates barcodes before issuing the query', async () => {
    renderHook(() => useProductDepartments(['111', '111', '222', '111']));
    await waitFor(() => expect(inMock).toHaveBeenCalledTimes(1));
    const arg = inMock.mock.calls[0][1] as string[];
    expect([...arg].sort()).toEqual(['111', '222']);
  });

  it('does not re-fetch when the barcode set is identical between renders', async () => {
    const { rerender } = renderHook(({ b }: { b: string[] }) => useProductDepartments(b), {
      initialProps: { b: ['111', '222'] },
    });
    await waitFor(() => expect(inMock).toHaveBeenCalledTimes(1));
    rerender({ b: ['222', '111'] }); // same set, different order / identity
    await waitFor(() => expect(inMock).toHaveBeenCalledTimes(1));
  });

  it('re-fetches when the barcode set actually changes', async () => {
    const { rerender } = renderHook(({ b }: { b: string[] }) => useProductDepartments(b), {
      initialProps: { b: ['111'] },
    });
    await waitFor(() => expect(inMock).toHaveBeenCalledTimes(1));
    rerender({ b: ['111', '333'] });
    await waitFor(() => expect(inMock).toHaveBeenCalledTimes(2));
  });

  it('returns an empty map on DB error (does not throw)', async () => {
    inMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useProductDepartments(['111']));
    await waitFor(() => expect(inMock).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });
});
