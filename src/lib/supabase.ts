import { createClient } from '@supabase/supabase-js';
import type { DepartmentCode } from './departments';

export const AUTH_STORAGE_KEY = 'shoppinglist-auth-token';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY,
    },
  },
);

// ShoppingList tables live in the "shopping" schema (shared Supabase project
// with ProjectsManagerWeb). Use `db` instead of `supabase` for from/rpc.
export const SHOPPING_SCHEMA = 'shopping' as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = (supabase as any).schema(SHOPPING_SCHEMA);

// ---------- Domain types (mirror DB schema, see supabase/migrations/0001_init.sql) ----------

export type MemberRole = 'owner' | 'editor';
export type PurchaseSource = 'manual' | 'auto_inventory';

export interface ShoppingList {
  id: string;
  owner_id: string;
  name: string;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  department_order: DepartmentCode[] | null;
}

export interface ListMember {
  id: string;
  list_id: string;
  user_id: string | null;
  invited_email: string;
  role: MemberRole;
  invited_by: string;
  invited_at: string;
  joined_at: string | null;
}

export interface ListItem {
  id: string;
  list_id: string;
  name: string;
  qty: number;
  unit: string | null;
  notes: string | null;
  estimated_price: number | null;
  is_in_cart: boolean;
  sort_order: number;
  created_by: string | null;
  last_purchased_at: string | null;
  barcode: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  barcode: string;
  name: string;
  unit_qty: number | null;
  unit_measure: string | null;
  manufacturer: string | null;
}

export interface SearchProductResult extends Product {
  price: number;
  chain_code: string;
  chain_display_name: string;
  previously_bought: boolean;
}

// Brand colors used by the autocomplete chain badge. Keep this in sync with
// rows in shopping.chains; a missing entry falls back to neutral gray.
export const CHAIN_BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  shufersal: { bg: '#B91C1C', fg: '#FFFFFF' },
  rami_levy: { bg: '#1E3A8A', fg: '#FFFFFF' },
};

export interface PurchaseEvent {
  id: string;
  list_id: string;
  purchased_by: string;
  purchased_at: string;
  store_chain: string | null;
  store_branch: string | null;
  total_price: number | null;
  source: PurchaseSource;
  notes: string | null;
}

export interface PurchaseEventItem {
  id: string;
  event_id: string;
  list_item_id: string | null;
  name_snapshot: string;
  qty: number;
  unit_price: number | null;
  line_total: number | null;
}

export interface ListParticipant {
  list_id: string;
  user_id: string | null;
  email: string;
  role: MemberRole;
  joined_at: string | null;
}
