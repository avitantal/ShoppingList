# Handoff — Shopping List

**Last updated:** 2026-05-24
**Current state:** Code complete (v0.9.0). Production deployed. OAuth configured. **Pending: verify Google sign-in works on the live site.**

---

## What this is

A multi-user, real-time shopping list web app. Architecture mirrors `Claude_Projects/ProjectsManagerWeb` (React 19 + TS + Vite + Tailwind RTL + Supabase) with two new capabilities: multiple named lists per user, and co-edit sharing by Gmail address. Designed to be safely manageable by Claude via the user's Supabase MCP server (RLS-protected).

**Out of scope (deferred to phase 2):** automatic price fetching from Israeli supermarkets via MCP, home inventory + auto-generated lists, email invite delivery, read-only share links.

---

## Locations

| Thing | Where |
|---|---|
| Project dir | `C:\Users\avita\Claude_Projects\ShoppingList\` |
| Design spec | `docs/superpowers/specs/2026-05-23-shopping-list-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-05-23-shopping-list.md` |
| GitHub repo | https://github.com/avitantal/ShoppingList (public) |
| Live app | https://avitantal.github.io/ShoppingList/ |
| Privacy / Terms | https://avitantal.github.io/ShoppingList/privacy.html · `/terms.html` · `/home.html` (meta-refresh, used as OAuth home URL) |
| Supabase project | https://cddyczwevfpnnbbdilmq.supabase.co |
| Local `.env.local` | `C:\Users\avita\Claude_Projects\ShoppingList\.env.local` (has Supabase URL + anon key; **NOT in git**) |
| GitHub Actions secrets | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` set via `gh secret set` |

---

## What's done

- 28 commits, clean history, v0.9.0
- All unit tests pass (8/8 via Vitest), lint clean, build clean
- Supabase migration `supabase/migrations/0001_init.sql` (405 lines) **applied** — 5 tables, 16+ RLS policies, 7 RPCs, 3 views, `handle_new_user` trigger, `is_list_member` helper, `set_updated_at` trigger
- GitHub Pages deploy workflow at `.github/workflows/deploy.yml` — auto-deploys on push to `master`, uses `vite.config.ts` `base: process.env.GITHUB_ACTIONS ? '/ShoppingList/' : '/'`
- Google OAuth Client created (Web application) with:
  - Authorized JS origins: `https://avitantal.github.io`, `http://localhost:5173`
  - Authorized redirect URIs: `https://cddyczwevfpnnbbdilmq.supabase.co/auth/v1/callback`
- OAuth consent screen: Testing mode, `avitantal@gmail.com` added as test user, Home/Privacy/Terms URLs configured, authorized domain `avitantal.github.io`
- Supabase Google provider: Client ID + Secret pasted in, enabled
- Supabase Auth URL Config: **NEEDS VERIFICATION** — Site URL should be `https://avitantal.github.io/ShoppingList/`; Redirect URLs should include both prod and `http://localhost:5173/`

---

## What's open — pick up here

### Immediate (5 min)
1. **Verify Google sign-in works** on https://avitantal.github.io/ShoppingList/ → click "כניסה עם Google" → sign in as `avitantal@gmail.com` → bypass the "unverified app" warning (Advanced → Go to ... unsafe) → should land on app shell with "הרשימה שלי" auto-created.
2. **Smoke test:** add an item ("חלב 3%"), check it, "סיום קנייה" with chain "שופרסל" + price 6.90 → toast success → open היסטוריה → see the event.
3. **Share test:** open Share dialog, enter a second Gmail you control, sign in with that account in incognito, see the shared list appear in "ששותפו איתי".

### If sign-in fails
Likely causes, in order:
- **`redirect_uri_mismatch`** → check Supabase Auth → URL Configuration: Site URL + Redirect URLs must include `https://avitantal.github.io/ShoppingList/`. Google's redirect URI list is correct.
- **"Access blocked: Authorization Error"** → the signed-in Gmail isn't in Test users on the OAuth Consent Screen. Add it.
- **Lands at app but bounced back to sign-in** → probably session not persisting. Check browser console for Supabase errors.

### Phase-2 work (deferred)
- E2E tests: spec exists at `e2e/sharing.spec.ts`. Needs `SUPABASE_SERVICE_ROLE_KEY` + `E2E_USER_A_*` / `E2E_USER_B_*` env vars added to `.env.local`, then `npx playwright install chromium` (one-time, ~200MB) and `npm run e2e`. The dev-only password sign-in form in `Auth.tsx` (gated by `import.meta.env.DEV`) is the path for these tests.
- Auto-fetching prices via MCP — `estimated_price` column already exists; only need a fetcher (Israeli price-feed sources documented in spec §11).
- Home inventory + auto-list generation — spec §4.7, §11.
- Email invites via Edge Function for not-yet-registered emails — spec §11.

---

## Conventions / user preferences

- Hebrew RTL UI throughout; English in code/schema for MCP-friendliness.
- Always bump `package.json` version + commit when changing code (per global `~/.claude/CLAUDE.md`).
- Concise responses, no trailing summaries unless asked.
- Explain *why* (1-2 sentences) before significant action.
- Commit + push only when asked.
- Don't skip `superpowers:writing-plans` between `brainstorming` and implementation, even if user gives an implementation directive ("create the project"). They mean go through the chain. Saved in user memory.
- Use the subagent-driven-development flow (one fresh subagent per task / batch, two-stage review for substantive code, lighter for trivial config).
- `gh` CLI is installed and authenticated as `avitantal` (verified during setup).

---

## Known tech debt / minor issues

- `useListItems.ts` and `usePurchaseHistory.ts` use `as any` / `as unknown as` casts where the mock-Supabase chain doesn't expose `update`/`delete`/`in` methods. Acceptable for now; could be cleaned by extending `src/test/helpers/mockSupabase.ts` to add chained method stubs.
- README and MCP_GUIDE got committed in the same commit as `App.tsx` (commit `6485685`) instead of three separate commits — purely cosmetic.
- GitHub Actions warns about Node.js 20 deprecation (June 2026 cutoff) — non-blocking; should upgrade `actions/setup-node` to v5 with `node-version: '22'` (already done) and watch for new versions of `configure-pages`/`deploy-pages`/`upload-artifact`.
- `package.json` shows `shoppinglist@0.9.0` — bump to 1.0.0 after smoke + e2e pass.

---

## How to resume in a fresh Claude session

Open `C:\Users\avita\Claude_Projects\ShoppingList\` in Claude Code and paste this prompt:

> Resuming work on Shopping List. Read `HANDOFF.md` for current state, then look at `docs/superpowers/specs/...` and `docs/superpowers/plans/...` for the design and plan. Last open item: verify Google OAuth sign-in on the live site at https://avitantal.github.io/ShoppingList/. Continue from there.

The new agent should NOT redo planning or scaffolding — everything from Stages 0-8 is done.
