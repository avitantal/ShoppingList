import type { SearchProductResult } from './supabase';

const LS_KEY = 'productLinkDefaults.v1';
const MAX_DEFAULTS = 200;

interface StoredDefault {
  barcode: string;
  name: string;
  estimated_price: number;
  chain_code: string;
  chain_display_name: string;
  manufacturer: string | null;
  unit_qty: number | null;
  unit_measure: string | null;
  saved_at: string;
}

export interface ProductLinkDefault {
  barcode: string;
  name: string;
  estimated_price: number;
  chain_code: string;
  chain_display_name: string;
  manufacturer: string | null;
  unit_qty: number | null;
  unit_measure: string | null;
}

function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

function readDefaults(): Record<string, StoredDefault> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, StoredDefault>
      : {};
  } catch {
    return {};
  }
}

function writeDefaults(defaults: Record<string, StoredDefault>) {
  try {
    const entries = Object.entries(defaults)
      .sort((a, b) => (b[1].saved_at || '').localeCompare(a[1].saved_at || ''))
      .slice(0, MAX_DEFAULTS);
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* ignore */ }
}

export function getProductLinkDefault(itemName: string): ProductLinkDefault | null {
  const key = normalizeItemName(itemName);
  if (!key) return null;
  const stored = readDefaults()[key];
  if (!stored?.barcode || !stored.name || typeof stored.estimated_price !== 'number') return null;
  return {
    barcode: stored.barcode,
    name: stored.name,
    estimated_price: stored.estimated_price,
    chain_code: stored.chain_code,
    chain_display_name: stored.chain_display_name,
    manufacturer: stored.manufacturer ?? null,
    unit_qty: stored.unit_qty ?? null,
    unit_measure: stored.unit_measure ?? null,
  };
}

export function saveProductLinkDefault(itemName: string, product: SearchProductResult) {
  const key = normalizeItemName(itemName);
  if (!key) return;
  const defaults = readDefaults();
  defaults[key] = {
    barcode: product.barcode,
    name: product.name,
    estimated_price: product.price,
    chain_code: product.chain_code,
    chain_display_name: product.chain_display_name,
    manufacturer: product.manufacturer,
    unit_qty: product.unit_qty,
    unit_measure: product.unit_measure,
    saved_at: new Date().toISOString(),
  };
  writeDefaults(defaults);
}
