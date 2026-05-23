import { supabase } from './supabase';

function getRedirectTo(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location.origin + window.location.pathname;
}

export async function signInWithGoogle(redirectTo = getRedirectTo()) {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : {},
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
