import { Loader2 } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { Auth } from './components/Auth';
import { AppShell } from './components/AppShell';

export default function App() {
  const { session, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-muted" size={24} /></div>;
  }
  return session ? <AppShell /> : <Auth />;
}
