// MCP Streamable HTTP server (stateless) for shopping lists.
// Deployed with verify_jwt=false: the OAuth discovery dance requires
// answering unauthenticated requests. JWT is verified locally in auth.ts.
import { verifyUserJwt, userClient } from './auth.ts';
import { TOOLS, callTool } from './tools.ts';

const SUPABASE_URL = 'https://xgihixrhosbxyloeoxnv.supabase.co';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/mcp-shopping`;
const RESOURCE_METADATA_URL = `${FUNCTION_URL}/.well-known/oauth-protected-resource`;

const PROTOCOL_VERSION = '2025-06-18';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function unauthorized() {
  return json({ error: 'unauthorized' }, 401, {
    'www-authenticate': `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`,
  });
}

function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: FUNCTION_URL,
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'],
    });
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authz = req.headers.get('authorization') ?? '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return unauthorized();

  const claims = await verifyUserJwt(token);
  if (!claims) return unauthorized();

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try { msg = await req.json(); } catch { return rpcError(null, -32700, 'parse error'); }
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'invalid request');
  }

  switch (msg.method) {
    case 'initialize':
      return json({
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'shopping-lists', version: '1.0.0' },
        },
      });
    case 'notifications/initialized':
      return new Response(null, { status: 202 });
    case 'ping':
      return json({ jsonrpc: '2.0', id: msg.id, result: {} });
    case 'tools/list':
      return json({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    case 'tools/call': {
      const db = userClient(token); // per-request, never cached
      const result = await callTool(db, claims, msg.params ?? {});
      return json({ jsonrpc: '2.0', id: msg.id, result });
    }
    default:
      return rpcError(msg.id, -32601, 'method not found');
  }
});
