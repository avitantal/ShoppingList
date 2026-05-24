# Handoff — Shopping List

**Last updated:** 2026-05-24 (post-DB-consolidation)
**Current state:** v0.10.2 deployed. ShoppingList now lives in the same Supabase project as ProjectsManagerWeb under a dedicated `shopping` schema. **Working end-to-end:** sign-in, list creation, item add, realtime, checkbox toggle. **Known gap:** no UI to edit `qty` / `unit` / `estimated_price` on a list item after it's added (see "Open design gap" below).

---

## What this is

A multi-user, real-time shopping list web app. React 19 + TS + Vite + Tailwind RTL + Supabase, mirroring `Claude_Projects/ProjectsManagerWeb`. Two distinguishing capabilities: multiple named lists per user, and co-edit sharing by Gmail address. Designed to be safely manageable by Claude via the user's Supabase MCP (RLS-protected).

**Out of scope (deferred to phase 2):** auto-fetching prices from Israeli supermarkets via MCP, home inventory + auto-generated lists, email invite delivery, read-only share links.

---

## Where everything lives (post-consolidation)

| Thing | Where |
|---|---|
| Project dir | `C:\Users\avita\Claude_Projects\ShoppingList\` |
| Design spec | `docs/superpowers/specs/2026-05-23-shopping-list-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-05-23-shopping-list.md` |
| GitHub repo | https://github.com/avitantal/ShoppingList (public) |
| Live app | https://avitantal.github.io/ShoppingList/ |
| Privacy / Terms | https://avitantal.github.io/ShoppingList/privacy.html · `/terms.html` · `/home.html` |
| **Supabase project (NEW)** | `xgihixrhosbxyloeoxnv` — **shared with ProjectsManagerWeb** under schema `shopping` |
| Supabase URL | https://xgihixrhosbxyloeoxnv.supabase.co |
| Old Supabase (deprecated) | `cddyczwevfpnnbbdilmq` — still active but unused; can be paused/deleted after ~1 week of stability |
| Local `.env.local` | Points to `xgihixrhosbxyloeoxnv` — has Supabase URL + anon key (**NOT in git**) |
| GitHub Actions secrets | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set to `xgihixrhosbxyloeoxnv` |

---

## Migration history

1. `0001_init.sql` — original schema in `public` of `cddyczwevfpnnbbdilmq`. **Superseded** by 0003.
2. `0002_rpcs_security_definer.sql` — changed RPCs from `security invoker` to `security definer` to bypass an RLS-with-check edge case that rejected `create_list` INSERTs. Applied to old project.
3. **`0003_consolidate_into_shopping_schema.sql`** — re-creates everything under `shopping.*` in PMW Supabase. Drops the `auth.users` `handle_new_user` trigger; default-list bootstrap is now app-level (see useLists). Applied to new project.
4. **`0004_ensure_default_list_idempotent.sql`** — adds `shopping.ensure_default_list()` with `pg_advisory_xact_lock` per user, so concurrent first-load refresh() calls can't race-create duplicate "הרשימה שלי" rows. Also cleans up dups created before the fix. Applied to new project.

`0001` + `0002` remain in the repo as historical record of the old project; they will not be re-applied.

---

## Code conventions for the consolidated DB

- **Never** use `supabase.from('shopping_lists')` directly. Use the `db` export from `src/lib/supabase.ts`:
  ```ts
  import { db } from '../lib/supabase';
  await db.from('shopping_lists').select('*');
  await db.rpc('create_list', {...});
  ```
  `db` is `supabase.schema('shopping')`.
- Realtime channels: use the `SHOPPING_SCHEMA` constant when constructing `postgres_changes` filters:
  ```ts
  supabase.channel(...).on('postgres_changes', { schema: SHOPPING_SCHEMA, table: 'list_items', ... });
  ```
- Channel names should be made unique per mount (suffix with `Math.random()`) — StrictMode reuses by name and throws "cannot add callbacks after subscribe".
- Always check the `error` field on `await db.from(...)` and `await db.rpc(...)` — the UI surfaces errors via `useLists`' `error` state in AppShell.

---

## Working end-to-end as of v0.10.2

- Google OAuth sign-in via the consolidated Supabase Auth.
- Default list "הרשימה שלי" is created on first sign-in via the idempotent `ensure_default_list` RPC.
- Item add via `add_item` RPC.
- Checkbox toggle updates `is_in_cart` with optimistic UI + realtime broadcast.
- Swipe-to-delete works (`db.from('list_items').delete()`).
- New list creation via `create_list`.
- Version label `v{x.y.z}` shown at top of header (auto-wired to package.json via Vite `define`).

---

## Open design gap — item editing UI (NOT TOUCHED)

Per spec §4.4 + §7.2, a `list_items` row has `qty`, `unit`, `estimated_price`. `ItemRow.tsx` shows them only when they're **non-default** (qty ≠ 1 or unit present). **But there is no UI to edit them after the item is added.** `AddItemInput.tsx` only takes a name.

The spec didn't define the edit flow. Options:
- **A:** Tap on item name opens an edit dialog (name + qty + unit + price + notes).
- **B:** Inline editable fields next to the name (qty stepper, unit dropdown, price input).
- **C:** Long-press / context menu → "Edit item".

`useListItems.updateItem` already supports the mutation; only the UI is missing. Pick one and wire it up in a follow-up session.

---

## Manual Supabase configuration (already done)

For future reference if anyone has to redo this in a fresh project:

1. **Exposed schemas (PostgREST):** Supabase Dashboard → Settings → API → "Exposed schemas" must include `shopping` alongside `public`. PostgREST returns `PGRST106: Invalid schema: shopping` if it's missing.
2. **Auth → URL Configuration:** Site URL is PMW's (`https://avitantal.github.io/ProjectsManagerWeb`). Redirect URLs include `https://avitantal.github.io/ShoppingList/**` and `http://localhost:5173/**`.
3. **Google OAuth Client (Cloud Console):** Authorized redirect URIs include `https://xgihixrhosbxyloeoxnv.supabase.co/auth/v1/callback`. The old `cddyczwevfpnnbbdilmq` URI is kept for now as a rollback safety net.
4. **GitHub Actions secrets:** `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` updated via `gh secret set`.

---

## Phase-2 backlog

- **Item editing UI** (see "Open design gap" above) — highest priority.
- **E2E tests via Playwright.** Spec at `e2e/sharing.spec.ts`. Needs `SUPABASE_SERVICE_ROLE_KEY` + `E2E_USER_A_*` / `E2E_USER_B_*` env vars in `.env.local`, then `npx playwright install chromium` and `npm run e2e`. The dev-only password sign-in form in `Auth.tsx` (gated by `import.meta.env.DEV`) is the path for these tests.
- **Auto-fetching prices via MCP** — `estimated_price` column already exists; only need a fetcher (chp.co.il / supermarket OData / Israeli price-feed MCP).
- **Home inventory + auto-list generation** — spec §4.7, §11.
- **Email invites via Edge Function** for not-yet-registered emails — spec §11.
- **Pause / delete the old `cddyczwevfpnnbbdilmq` project** after ~1 week of stability on the consolidated one (and remove the old redirect URI from the Google OAuth Client).

---

## Conventions / user preferences

- Hebrew RTL UI throughout; English in code/schema for MCP-friendliness.
- Always bump `package.json` version on code changes — and if the UI has no version label, add one at the top of the page (the v-label is in `AppShell.tsx`, wired through Vite `define` → `__APP_VERSION__` global).
- Concise responses, no trailing summaries unless asked.
- Explain *why* (1-2 sentences) before significant action.
- Commit + push only when asked.
- Don't skip `superpowers:writing-plans` between brainstorming and implementation, even if the user gives an implementation directive.
- `gh` CLI is installed and authenticated as `avitantal`.

---

## How to resume in a fresh Claude session

Open `C:\Users\avita\Claude_Projects\ShoppingList\` in Claude Code and paste:

> Resuming work on Shopping List. Read `HANDOFF.md` for current state. Open items: (a) item-editing UI (see "Open design gap"), (b) phase-2 backlog. DB lives in shared PMW Supabase under `shopping` schema — use the `db` export from `src/lib/supabase.ts` and the `claude.ai Supabase` MCP with `project_id: xgihixrhosbxyloeoxnv` and `schemas: ["shopping"]` for list_tables / SQL.
