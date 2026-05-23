import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.VITE_SUPABASE_URL!;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

export async function ensureUser(email: string, password: string): Promise<string> {
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing?.users.find(u => u.email === email);
  if (found) return found.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return data.user!.id;
}

export async function purgeListsForUser(userId: string) {
  await admin.from('shopping_lists').delete().eq('owner_id', userId);
}
