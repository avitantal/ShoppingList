import { vi } from 'vitest';

export type Row = Record<string, unknown>;

export function makeMockClient(tables: Record<string, Row[]>, rpc: Record<string, (args: unknown) => unknown> = {}) {
  function from(table: string) {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {
      data: rows, error: null,
      select: vi.fn(() => chain),
      eq:     vi.fn(() => chain),
      order:  vi.fn(() => chain),
      is:     vi.fn(() => chain),
      then:   (cb: (r: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(cb),
    };
    return chain;
  }
  function channel() {
    return {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    };
  }
  function removeChannel() { /* noop */ }
  return {
    from,
    channel,
    removeChannel,
    rpc: vi.fn((name: string, args: unknown) => Promise.resolve({ data: rpc[name]?.(args) ?? null, error: null })),
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'u1', email: 'me@example.com' } } })) },
  };
}
