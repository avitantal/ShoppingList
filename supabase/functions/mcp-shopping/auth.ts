import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const SUPABASE_URL = 'https://xgihixrhosbxyloeoxnv.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
// Public keys — safe (and correct) to cache at module scope.
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

// Anon (publishable) key: public by design, required for PostgREST routing.
const ANON_KEY = Deno.env.get('SB_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

export interface UserClaims { sub: string; email?: string }

/** Local verification only — no I/O beyond the cached JWKS fetch.
 *  Enforces: signature, exp, iss, aud, role === 'authenticated'
 *  (a service_role JWT as Bearer would bypass RLS — hard reject), and a
 *  non-anonymous identity: anonymous sign-ups also carry
 *  role === 'authenticated', so without this check any stranger holding the
 *  public anon key could mint a token this endpoint would serve. */
export async function verifyUserJwt(token: string): Promise<UserClaims | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: 'authenticated',
    });
    if (payload.role !== 'authenticated') return null;
    if (payload.is_anonymous === true) return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
  } catch {
    return null;
  }
}

/** Fresh client per request — Edge isolates are reused across requests;
 *  a module-level client would leak one user's token to another. */
export function userClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: 'shopping' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
