import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { Auth } from './components/Auth';
import { AppShell } from './components/AppShell';
import { hardResetAuth } from './lib/googleAuth';
import { OAuthConsent, AUTHZ_STORAGE_KEY } from './components/OAuthConsent';

// Capture and scrub the OAuth consent param once, at module load: it must
// survive the Google-login round trip but must not linger in the visible URL.
const urlAuthId = new URLSearchParams(window.location.search).get('authorization_id');
if (urlAuthId) {
  sessionStorage.setItem(AUTHZ_STORAGE_KEY, urlAuthId);
  const clean = new URL(window.location.href);
  clean.searchParams.delete('authorization_id');
  window.history.replaceState(null, '', clean.toString());
}

export default function App() {
  const { session, loading } = useAuth();
  const authorizationId = sessionStorage.getItem(AUTHZ_STORAGE_KEY);
  if (authorizationId) return <OAuthConsent authorizationId={authorizationId} />;
  if (loading) return <LoadingScreen />;
  return session ? <AppShell /> : <Auth />;
}

function LoadingScreen() {
  // Surface a recovery panel only after the longest legitimate auth path
  // (PKCE callback over slow mobile data ≈ several seconds). useAuth's
  // own giveup timer is 15s; show recovery shortly after that so we don't
  // tempt users to hit Refresh in the middle of a working sign-in.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setStuck(true), 18000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 text-center">
      <Loader2 className="animate-spin text-muted" size={24} />
      {stuck && (
        <div className="max-w-xs space-y-3">
          <p className="text-sm text-muted">
            ההתחברות לוקחת יותר מדי זמן. אפשר לרענן או להתנתק ולנסות שוב.
          </p>
          <div className="flex gap-2 justify-center">
            <button className="btn-ghost text-sm" onClick={() => window.location.reload()}>
              רענן
            </button>
            <button className="btn-ghost text-sm text-red-400"
                    onClick={() => { hardResetAuth(); window.location.reload(); }}>
              אפס מצב התחברות
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
