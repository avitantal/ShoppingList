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

// Nukes every supabase-js storage artifact in localStorage. Use when the
// sign-in flow is stuck in a loop because of stale PKCE state — typically
// from an aborted previous OAuth attempt or a project-ref change. Does
// NOT call supabase.auth.signOut() because that itself may hang on
// corrupted state; this is a deliberate offline-only wipe.
export function hardResetAuth() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('sb-') || k === 'activeListId')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
