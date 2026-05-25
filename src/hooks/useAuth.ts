import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { hardResetAuth } from '../lib/googleAuth';

// Steady-state timeout (no OAuth callback in URL). If getSession() never
// resolves we still want to surface the sign-in screen instead of an
// infinite spinner.
const AUTH_TIMEOUT_MS = 7000;
// Mid-callback timeout: PKCE code exchange is a network round-trip; on
// slow mobile networks 7s is too tight. Be patient before giving up.
const CALLBACK_TIMEOUT_MS = 15000;

// True when the page just landed on an OAuth provider redirect — supabase
// will exchange the code in the background and fire onAuthStateChange
// when done. We must NOT trust getSession()'s null in this window, or we
// race the exchange and flash the Login screen on mobile.
function hasOAuthCallbackInUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const { search, hash } = window.location;
  return /[?&](code|error)=/.test(search) || /[#&](access_token|error)=/.test(hash);
}

function stripOAuthParamsFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    ['code', 'state', 'error', 'error_description', 'provider_token'].forEach(k => url.searchParams.delete(k));
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  } catch { /* ignore */ }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const callback = hasOAuthCallbackInUrl();

    const settle = (s: Session | null) => {
      if (cancelled) return;
      setSession(s);
      setLoading(false);
    };

    // When mid-callback, also scrub the URL AND wipe stale supabase-js
    // storage on giveup so a reload doesn't re-attempt the same expired
    // code or get poisoned by leftover state from the failed exchange.
    const timer = window.setTimeout(() => {
      if (callback) {
        stripOAuthParamsFromUrl();
        hardResetAuth();
      }
      settle(null);
    }, callback ? CALLBACK_TIMEOUT_MS : AUTH_TIMEOUT_MS);

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      window.clearTimeout(timer);
      settle(s);
    });

    // Mid-callback: skip getSession() — supabase is doing the PKCE
    // exchange in the background and onAuthStateChange will tell us
    // when it's done. Calling getSession() here races the exchange and
    // can resolve null first, flashing the user back to the login screen.
    if (!callback) {
      supabase.auth.getSession()
        .then(({ data }) => { window.clearTimeout(timer); settle(data.session); })
        .catch(()         => { window.clearTimeout(timer); settle(null); });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
