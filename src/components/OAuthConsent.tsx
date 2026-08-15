import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Auth } from './Auth';

// Hosts we expect OAuth clients to redirect back to. Anything else gets a
// loud warning (defense against consent phishing).
const EXPECTED_HOSTS = ['claude.ai', 'claude.com'];

export const AUTHZ_STORAGE_KEY = 'oauth_authorization_id';

function hostOf(raw: string): string {
  try { return new URL(raw).hostname; } catch { return '(כתובת לא תקינה)'; }
}

function isTrustedHost(raw: string): boolean {
  try {
    const { hostname } = new URL(raw);
    return EXPECTED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
  } catch { return false; }
}

export function OAuthConsent({ authorizationId }: { authorizationId: string }) {
  const { session, loading } = useAuth();
  const [details, setDetails] =
    useState<{ clientName: string; redirectHost: string; hostTrusted: boolean } | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const framed = window.top !== window.self;

  useEffect(() => {
    if (!session || framed) return;
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (error || !data) {
        setErr('בקשת ההרשאה לא נמצאה או שפגה. סגור את החלון ונסה שוב מהאפליקציה המבקשת.');
        return;
      }
      if (!('authorization_id' in data)) {
        // Previously approved — still requires an explicit click, never auto-navigate.
        const url = (data as { redirect_url: string }).redirect_url;
        setPendingUrl(url);
        setDetails({
          clientName: 'אפליקציה שאושרה בעבר',
          redirectHost: hostOf(url),
          hostTrusted: isTrustedHost(url),
        });
        return;
      }
      const redirectUri = data.redirect_uri ?? '';
      setDetails({
        clientName: data.client?.name ?? 'אפליקציה לא מזוהה',
        redirectHost: hostOf(redirectUri),
        // Judged BEFORE approval: the grant must never exist before the user
        // has seen — and accepted — where they will be sent.
        hostTrusted: isTrustedHost(redirectUri),
      });
    });
  }, [session, authorizationId, framed]);

  function finish() {
    sessionStorage.removeItem(AUTHZ_STORAGE_KEY);
  }

  /** Last line of defense: https-only (localhost in dev), explicit navigation.
   *  Host trust is decided earlier, before the grant is issued. */
  function safeRedirect(raw: string): boolean {
    let u: URL;
    try { u = new URL(raw); } catch { return false; }
    const devOk = u.protocol === 'http:' && u.hostname === 'localhost';
    if (u.protocol !== 'https:' && !devOk) return false;
    finish();
    window.location.assign(u.href);
    return true;
  }

  async function decide(approve: boolean) {
    setBusy(true);
    // skipBrowserRedirect is REQUIRED: without it the SDK navigates itself,
    // bypassing safeRedirect() and the open-redirect protection entirely.
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    setBusy(false);
    if (error || !data?.redirect_url) { setErr('שגיאה בעיבוד ההחלטה. נסה שוב.'); return; }
    if (!safeRedirect(data.redirect_url)) {
      setErr('כתובת החזרה שביקשה האפליקציה אינה בטוחה — החיבור בוטל.');
    }
  }

  function abandon() {
    finish();
    window.location.reload();
  }

  if (framed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-sm">
        דף זה חייב להיפתח בחלון עצמאי. פתח את הקישור ישירות בדפדפן.
      </div>
    );
  }
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  }
  if (!session) return <Auth />;
  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-sm p-6 space-y-4 text-center">
          <p className="text-sm">{err}</p>
          <button className="btn-primary w-full justify-center" onClick={abandon}>חזור לאפליקציה</button>
        </div>
      </div>
    );
  }
  if (pendingUrl && details) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-sm p-6 space-y-4 text-center">
          <p className="text-sm">אושר בעבר. להמשיך אל <b dir="ltr">{details.redirectHost}</b>?</p>
          <button className="btn-primary w-full justify-center" onClick={() => safeRedirect(pendingUrl)}>המשך</button>
          <button className="btn-ghost w-full justify-center text-sm" onClick={abandon}>בטל</button>
        </div>
      </div>
    );
  }
  if (!details) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6 space-y-5">
        <div className="text-center">
          <div className="text-3xl mb-2">🛒</div>
          <h1 className="text-lg font-semibold">בקשת גישה לרשימות הקניות</h1>
        </div>
        {/* The redirect host is the trustworthy identity signal, not the client name. */}
        <div className="text-sm space-y-1">
          <p><span className="text-muted">אפליקציה:</span> {details.clientName}</p>
          <p><span className="text-muted">תוחזר אל:</span> <b dir="ltr">{details.redirectHost}</b></p>
          {!details.hostTrusted && (
            <p className="text-red-400 pt-2">
              ⚠️ כתובת ההחזרה אינה של Claude. אם לא יזמת את הבקשה הזו — דחה אותה.
            </p>
          )}
          <p className="text-muted pt-2">
            האפליקציה תשתמש בכלים: צפייה ברשימות ובפריטים, הוספת פריט, וסימון פריט בעגלה.
          </p>
          <p className="text-muted">
            שים לב: ההרשאה הניתנת היא של חשבונך המלא באפליקציה ואינה מוגבלת טכנית לכלים
            האלה. אשר רק אפליקציות שאתה סומך עליהן.
          </p>
        </div>
        <div className="space-y-2">
          {details.hostTrusted ? (
            <>
              <button className="btn-primary w-full justify-center py-3" disabled={busy} onClick={() => void decide(true)}>
                {busy ? <Loader2 className="animate-spin" size={16} /> : 'אשר גישה'}
              </button>
              <button className="btn-ghost w-full justify-center text-sm" disabled={busy} onClick={() => void decide(false)}>
                דחה
              </button>
            </>
          ) : (
            <>
              <button className="btn-primary w-full justify-center py-3" disabled={busy} onClick={() => void decide(false)}>
                {busy ? <Loader2 className="animate-spin" size={16} /> : 'דחה את הבקשה'}
              </button>
              <button className="btn-ghost w-full justify-center text-sm" disabled={busy} onClick={() => void decide(true)}>
                אשר בכל זאת
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
