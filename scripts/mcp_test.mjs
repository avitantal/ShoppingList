// Node >= 20. Usage: node scripts/mcp_test.mjs
// Reads .env.local for VITE_SUPABASE_ANON_KEY and E2E_USER_A/B credentials.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

export const SUPABASE_URL = 'https://xgihixrhosbxyloeoxnv.supabase.co';
export const FN = `${SUPABASE_URL}/functions/v1/mcp-shopping`;
export const ANON = env.VITE_SUPABASE_ANON_KEY;
export const USER_A = { email: env.E2E_USER_A_EMAIL, password: env.E2E_USER_A_PASSWORD };
export const USER_B = { email: env.E2E_USER_B_EMAIL, password: env.E2E_USER_B_PASSWORD };

let failures = 0;
export function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ← ' + detail}`);
  if (!cond) failures++;
}

export async function login({ email, password }) {
  const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session.access_token;
}

export async function rpc(token, method, params = {}, id = 1) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

// ---- tests (added task by task) ----
const tests = [];
export function test(name, fn) { tests.push([name, fn]); }

// Task 2 tests land here…

for (const [name, fn] of tests) {
  try { await fn(); } catch (e) { check(name, false, e.message); }
}
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
