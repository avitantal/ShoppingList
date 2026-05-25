import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartTotalFooter } from '../../components/CartTotalFooter';
import type { ListItem } from '../../lib/supabase';

function item(over: Partial<ListItem> = {}): ListItem {
  return {
    id: 'x', list_id: 'l', name: 'x', qty: 1, unit: null, notes: null,
    estimated_price: null, is_in_cart: false, sort_order: 0,
    created_by: null, last_purchased_at: null, barcode: null,
    created_at: '', updated_at: '',
    ...over,
  };
}

describe('CartTotalFooter', () => {
  it('renders nothing when list is empty', () => {
    const { container } = render(<CartTotalFooter items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no item has a price', () => {
    const { container } = render(<CartTotalFooter items={[item({ name: 'a' }), item({ name: 'b' })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sums price × qty over not-in-cart items', () => {
    render(<CartTotalFooter items={[
      item({ id: '1', estimated_price: 6.9, qty: 2 }),                          // 13.80
      item({ id: '2', estimated_price: 10.5, qty: 1 }),                         // 10.50
      item({ id: '3', estimated_price: 99,   qty: 1, is_in_cart: true }),       // excluded
    ]} />);
    expect(screen.getByText(/₪24\.30/)).toBeInTheDocument();
  });

  it('shows the ⓘ marker when some items lack a price', () => {
    render(<CartTotalFooter items={[
      item({ id: '1', estimated_price: 6.9, qty: 1 }),
      item({ id: '2', estimated_price: null, qty: 1 }),
    ]} />);
    expect(screen.getByLabelText(/פריטים ללא מחיר/)).toBeInTheDocument();
  });
});
