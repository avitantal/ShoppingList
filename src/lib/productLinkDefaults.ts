import { db, type SearchProductResult } from './supabase';

export async function getProductLinkDefault(itemName: string): Promise<SearchProductResult | null> {
  const { data, error } = await db.rpc('get_product_link_default', {
    p_item_name: itemName,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? row as SearchProductResult : null;
}

export async function saveProductLinkDefault(itemName: string, product: SearchProductResult) {
  const { error } = await db.rpc('save_product_link_default', {
    p_item_name: itemName,
    p_barcode: product.barcode,
    p_chain_code: product.chain_code,
  });
  if (error) throw error;
}
