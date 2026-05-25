import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { Auth } from './components/Auth';
import { AppShell } from './components/AppShell';
import { signOut } from './lib/googleAuth';

export default function App() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return session ? <AppShell /> : <Auth />;
}

function LoadingScreen() {
  // If auth takes longer than this, surface a recovery panel so the user
  // isn't stuck staring at the spinner with no way out.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setStuck(true), 4000);
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
                    onClick={() => { void signOut().finally(() => window.location.reload()); }}>
              התנתק
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
