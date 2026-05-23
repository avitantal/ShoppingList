# Shopping List

רשימת קניות שיתופית בזמן אמת — React 19 + Vite + Supabase.

## Setup

1. Create a Supabase project. Enable Google OAuth (Auth → Providers).
2. Copy `.env.example` → `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Add `SUPABASE_SERVICE_ROLE_KEY` if running e2e tests.
3. Apply the migration in `supabase/migrations/0001_init.sql` via the Supabase SQL editor (or `supabase db push` locally).
4. `npm install && npm run dev`.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run test` | Vitest watch |
| `npm run test:run` | Vitest single run |
| `npm run e2e` | Playwright e2e (needs `E2E_USER_*` env vars) |
| `npm run lint` | ESLint |

## Architecture

See `docs/superpowers/specs/2026-05-23-shopping-list-design.md` for the full spec and `docs/superpowers/plans/2026-05-23-shopping-list.md` for the implementation plan.

## MCP integration

See `docs/MCP_GUIDE.md` for connecting Claude to your own Supabase project via the Supabase MCP server.
