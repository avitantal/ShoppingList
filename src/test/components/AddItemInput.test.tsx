import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddItemInput } from '../../components/AddItemInput';

const rpcMock = vi.fn();
vi.mock('../../lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../lib/supabase')>('../../lib/supabase');
  return {
    ...actual,
    db: { rpc: (...args: unknown[]) => rpcMock(...args) },
  };
});

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({
    data: [
      { barcode: '1', name: 'חלב תנובה 3%', unit_qty: 1, unit_measure: 'ליטר', manufacturer: 'תנובה', price: 6.9,  chain_code: 'shufersal', chain_display_name: 'שופרסל' },
      { barcode: '2', name: 'חלב סויה',    unit_qty: 1, unit_measure: 'ליטר', manufacturer: null,    price: 9.9,  chain_code: 'shufersal', chain_display_name: 'שופרסל' },
    ],
    error: null,
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('AddItemInput combobox', () => {
  it('free-text submit calls onAdd with name only (no barcode)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddItemInput onAdd={onAdd} />);
    const input = screen.getByPlaceholderText(/הוסף פריט/);
    await userEvent.type(input, 'משהו ייחודי{Enter}');
    expect(onAdd).toHaveBeenCalledWith('משהו ייחודי', undefined);
  });

  it("selecting a row calls onAdd with that row's barcode", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddItemInput onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(/הוסף פריט/), 'חלב');
    await waitFor(() => expect(screen.getByText(/חלב תנובה 3%/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/חלב תנובה 3%/));
    expect(onAdd).toHaveBeenCalledWith('חלב תנובה 3%', '1');
  });

  it('renders a chain badge per result row', async () => {
    render(<AddItemInput onAdd={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/הוסף פריט/), 'חלב');
    await waitFor(() => expect(screen.getAllByText('שופרסל')).toHaveLength(2));
  });

  it('Esc closes the dropdown', async () => {
    render(<AddItemInput onAdd={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/הוסף פריט/), 'חלב');
    await waitFor(() => expect(screen.getByText(/חלב תנובה 3%/)).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/חלב תנובה 3%/)).not.toBeInTheDocument();
  });
});
