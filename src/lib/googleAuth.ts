import { supabase } from './supabase';

function getRedirectTo(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location.origin + window.location.pathname;
}

export async function signInWithGoogle(redirectTo = getRedirectTo()) {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      ...(redirectTo ? { redirectTo } : {}),
      // Always show Google's account chooser so users can switch accounts
      // (and so the first-time consent flow is unambiguous).
      queryParams: { prompt: 'select_account' },
    },
  });
}

export async function signOut() {
  // Clear app-local state that's tied to the previous user, so the next
  // sign-in starts on a clean slate (no stale active-list pointing at a
  // list the new user can't see).
  try { localStorage.removeItem('activeListId'); } catch { /* ignore */ }
  await supabase.auth.signOut();
}
