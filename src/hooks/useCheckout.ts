import { useState } from 'react';
import { toast } from 'sonner';
import { db } from '../lib/supabase';
import { normalizeStoreName } from '../lib/format';

export interface CheckoutItemInput {
  list_item_id?: string;
  name: string;
  qty: number;
  unit_price?: number | null;
}

export function useCheckout(listId: string | null) {
  const [submitting, setSubmitting] = useState(false);

  async function checkout(input: { storeChain: string; storeBranch: string; items: CheckoutItemInput[] }) {
    if (!listId) return null;
    if (input.items.length === 0) { toast.error('אין פריטים בעגלה'); return null; }
    setSubmitting(true);
    const { data, error } = await db.rpc('complete_checkout', {
      p_list_id: listId,
      p_store_chain:  normalizeStoreName(input.storeChain),
      p_store_branch: normalizeStoreName(input.storeBranch),
      p_items: input.items.map(i => ({
        list_item_id: i.list_item_id ?? null,
        name: i.name,
        qty: i.qty,
        unit_price: i.unit_price ?? null,
      })),
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return null; }
    toast.success(`✅ נשמרו ${input.items.length} פריטים`);
    return data as string;
  }

  return { checkout, submitting };
}
