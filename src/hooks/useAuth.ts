import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// If getSession or the OAuth-callback exchange hangs (slow network, dead
// token refresh, mangled URL params), we still want the user to land on
// the sign-in screen instead of staring at an infinite spinner.
const AUTH_TIMEOUT_MS = 7000;

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const settle = (s: Session | null) => {
      if (cancelled) return;
      setSession(s);
      setLoading(false);
    };

    const timer = window.setTimeout(() => settle(null), AUTH_TIMEOUT_MS);

    supabase.auth.getSession()
      .then(({ data }) => { window.clearTimeout(timer); settle(data.session); })
      .catch(()         => { window.clearTimeout(timer); settle(null); });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      window.clearTimeout(timer);
      settle(s);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
