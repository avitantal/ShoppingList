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

// ---- Task 2 ----

test('unauthenticated POST → 401 + WWW-Authenticate', async () => {
  const r = await rpc(null, 'initialize');
  check('401 status', r.status === 401, `got ${r.status}`);
  const www = r.headers.get('www-authenticate') ?? '';
  check('WWW-Authenticate points at resource metadata',
    www.includes('resource_metadata=') && www.includes('/.well-known/oauth-protected-resource'), www);
});

test('protected-resource metadata served', async () => {
  const res = await fetch(`${FN}/.well-known/oauth-protected-resource`);
  const j = await res.json();
  check('metadata 200', res.status === 200, String(res.status));
  check('authorization_servers correct',
    j.authorization_servers?.[0] === `${SUPABASE_URL}/auth/v1`, JSON.stringify(j));
});

// ---- Task 3 ----

test('garbage token → 401', async () => {
  const r = await rpc('garbage.token.here', 'initialize');
  check('garbage token rejected', r.status === 401, `got ${r.status}`);
});

test('anon key as Bearer → 401 (wrong role)', async () => {
  const r = await rpc(ANON, 'initialize');
  check('anon key rejected', r.status === 401, `got ${r.status}`);
});

test('valid user token → initialize succeeds', async () => {
  const t = await login(USER_A);
  const r = await rpc(t, 'initialize');
  check('initialize 200', r.status === 200, `got ${r.status}`);
  check('protocolVersion present', !!r.body?.result?.protocolVersion, JSON.stringify(r.body));
});

// ---- Task 4 ----

test('tools/list returns 4 tools', async () => {
  const t = await login(USER_A);
  const r = await rpc(t, 'tools/list');
  const names = (r.body?.result?.tools ?? []).map(x => x.name).sort();
  check('4 tools', JSON.stringify(names) ===
    JSON.stringify(['add_item', 'get_list_items', 'get_lists', 'set_item_in_cart']), JSON.stringify(names));
});

test('get_lists works and leaks nothing', async () => {
  const t = await login(USER_A);
  const r = await rpc(t, 'tools/call', { name: 'get_lists', arguments: {} });
  check('call ok', r.status === 200 && !r.body?.result?.isError, JSON.stringify(r.body));
  const text = r.body?.result?.content?.[0]?.text ?? '';
  const parsed = JSON.parse(text);
  check('lists array present', Array.isArray(parsed.lists), text);
  // USER_A's own default list is created lazily (ensure_default_list, idempotent) by
  // later tests in this file, so after a first run this is no longer empty. The real
  // invariant is ownership, not count: everything returned must be the user's own.
  check('no foreign lists for test user',
    parsed.lists.every((l) => l.shared_with_me === false), text);
});

// ---- Task 5 ----

async function ensureListFor(token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ensure_default_list`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'content-profile': 'shopping',
      'accept-profile': 'shopping',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`ensure_default_list failed: ${res.status} ${await res.text()}`);
}

test('add_item adds to own list', async () => {
  const t = await login(USER_A);
  await ensureListFor(t);
  const lists = await rpc(t, 'tools/call', { name: 'get_lists', arguments: {} });
  const listId = JSON.parse(lists.body.result.content[0].text).lists[0]?.id;
  check('user A has a list after bootstrap', !!listId, lists.body.result.content[0].text);
  const r = await rpc(t, 'tools/call', {
    name: 'add_item', arguments: { list_id: listId, name: 'חלב 3%', qty: 2 },
  });
  check('add ok', !r.body?.result?.isError, JSON.stringify(r.body?.result));
  const added = JSON.parse(r.body.result.content[0].text).added;
  check('returned item id', !!added?.id, JSON.stringify(added));
  const items = await rpc(t, 'tools/call', { name: 'get_list_items', arguments: { list_id: listId } });
  check('item visible in list', items.body.result.content[0].text.includes('חלב'),
    items.body.result.content[0].text);
});

for (const [name, fn] of tests) {
  try { await fn(); } catch (e) { check(name, false, e.message); }
}
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
