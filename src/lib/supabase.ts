import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

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
  created_at: string;
  updated_at: string;
}

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
