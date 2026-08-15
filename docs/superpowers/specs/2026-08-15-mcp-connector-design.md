# MCP Connector for Shopping Lists — Design

**Date:** 2026-08-15
**Status:** Implemented and security-reviewed twice (Eli: design + post-implementation,
2026-08-15). Connector code approved. Two pre-existing, project-wide issues found in the
second review remain open — see "Open issues" at the end. Not yet enabled: the OAuth 2.1
server is still off in the dashboard.

## Problem

Avita manages shopping lists in the app and adds items via Claude using the
official Supabase MCP connector. That connector authenticates with a Personal
Access Token — management-level access that bypasses RLS. It cannot be given
to other household members.

Goal: a **generic, user-scoped MCP connector** any app user can add to their
own Claude account (Free plan works — one custom connector allowed). Each user
authenticates as themselves; RLS limits them to lists they own or that were
shared with them via `list_members`.

## Decisions already made

- **Scope of tools:** view + add + cart-toggle. No deletion, no editing of
  qty/notes, no list management, no sharing management, no checkout.
- **Auth:** full OAuth — the user connects once, logs in with Google, approves.
  No API keys, no tokens pasted into URLs.
- **Approach A chosen:** everything lives in the existing Supabase project
  (`xgihixrhosbxyloeoxnv`). No new infrastructure.

## Architecture

```
Claude (any user)
  │  MCP over Streamable HTTP (JSON-RPC 2.0)
  ▼
Edge Function: mcp-shopping          ← new, in the existing project
  │  supabase-js with ANON KEY + user's Bearer JWT (never service-role)
  ▼
PostgREST → shopping schema RPCs + tables, RLS enforced as the user
```

### Auth flow — Supabase Auth OAuth 2.1 Server (beta)

Supabase Auth acts as the OAuth 2.1 identity provider (feature is in beta,
free on all plans, designed for MCP):

1. **Enable** OAuth 2.1 server: Dashboard → Authentication → OAuth Server.
   Enable **dynamic client registration** (Claude registers itself; DCR is
   gated by the mandatory consent screen).
2. **Discovery:** Claude fetches
   `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`.
   The Edge Function serves `/.well-known/oauth-protected-resource` metadata
   pointing at `https://<ref>.supabase.co/auth/v1`, and answers unauthenticated
   requests with `401` + `WWW-Authenticate` so Claude knows where to log in.
3. **Consent UI (frontend):** Supabase redirects the user to
   Site URL + Authorization Path with `?authorization_id=...`. The app is a
   single-page app with no router, so `App.tsx` detects the
   `authorization_id` query param and renders a new `OAuthConsent` component
   instead of the normal UI:
   - not logged in → normal Google login first (preserving the param)
   - `supabase.auth.oauth.getAuthorizationDetails(id)` → show client name +
     requested scopes in Hebrew ("Claude מבקש גישה לרשימות הקניות שלך")
   - Approve / Deny → `approveAuthorization` / `denyAuthorization` → redirect
     to the returned URL.
4. **Tokens:** Supabase issues access + refresh tokens for that user.
   Rotation/expiry handled by Supabase.

### Token handling in the Edge Function

- Function deployed with `verify_jwt = false` (the 401-discovery dance
  requires answering unauthenticated requests).
- On every MCP request: extract Bearer token, validate it by calling
  `auth.getUser(token)` (rejects expired/forged tokens), then execute all
  queries through a supabase-js client created with the **anon key** and
  `Authorization: Bearer <token>` — so every query runs as the user and RLS
  applies. The service-role key is never used in this function.

## MCP Tools

All tool descriptions written so Claude handles Hebrew item/list names
naturally. Tools call existing RPCs/tables — **zero schema changes**.

| Tool | Input | Behavior |
|------|-------|----------|
| `get_lists` | — | Active lists the user owns or is a member of: id, name, list type, open-item count. Owned/shared indicated. |
| `get_list_items` | `list_id` | Items with name, qty, unit, notes, `is_in_cart`, department name (via product link when present), grouped by department. |
| `add_item` | `list_id`, `name`, `qty?`, `unit?`, `notes?` | First tries the existing `search_products` RPC to match a real product (better spelling + department placement + barcode link), then calls `shopping.add_item`. Falls back to free-text name when no confident match. |
| `set_item_in_cart` | `item_id`, `in_cart` | Updates `list_items.is_in_cart`. RLS blocks non-members. |

Errors return JSON-RPC tool errors with clear messages (e.g. "אין לך גישה
לרשימה הזו") so Claude can relay them.

Realtime is already enabled on the shopping tables, so items added via the
connector appear instantly in the app.

## Security

Reviewed by Eli (2026-08-15). Verdict: architecture shape approved (anon key +
user JWT, no service-role in the function, RLS as boundary, four narrow
tools), but implementation is **blocked on database hardening** and the
requirements below are mandatory, not optional.

### Honest framing (Eli finding 4)

The OAuth token Supabase issues is a **full app identity** for the
`authenticated` role — not a connector-scoped capability. A token holder can
call PostgREST directly against every exposed schema, bypassing the four
tools. The consent-screen "scopes" are advisory text. Therefore the real
boundary is RLS across the *whole project*, which makes the prerequisite
fixes below part of this feature, not nice-to-haves.

### Prerequisite: DB hardening migration (blocking — Eli findings 1–3)

Live issues verified against the deployed database (exploitable today,
connector or not):

1. **`shopping.ingest_batch` is SECURITY DEFINER and callable by `anon`**
   (default PUBLIC EXECUTE was never revoked). Unauthenticated catalog
   poisoning. Revoke from `public/anon/authenticated`; grant `service_role`
   only. Audit all functions' `proacl` the same way.
2. **`staging_prices`, `ingested_files`, `product_price_changes`: RLS off,
   full DML granted to `authenticated`** (blanket
   `alter default privileges` from 0003). Enable RLS with no policies,
   revoke from `anon/authenticated`. Root-cause: drop/replace the blanket
   default privileges so future tables don't regress.
3. **`v_list_participants` (and the two other views) run as owner without
   `security_invoker`** — any authenticated user reads all membership rows
   and user emails. Set `security_invoker = on` on all three. Note: the view
   embeds a subselect on `auth.users` (email lookup) which the caller cannot
   read — wrap it in a narrow SECURITY DEFINER helper so the app's share
   dialog keeps working. Verify by impersonation query, not by reading SQL.

Verification of the fixes is by re-running Eli's impersonation queries and
`get_advisors(security)` — not by re-reading migration files (finding 14:
the deployed schema has drifted from the migrations; reconcile as part of
this migration).

### Implementation requirements (blocking — Eli findings 5–9)

- **JWT validation (8):** verify locally with `jose` against the cached
  JWKS (project already uses ES256): signature, `exp`,
  `iss === https://<ref>.supabase.co/auth/v1`, `aud` contains
  `authenticated`, and explicitly **`role === 'authenticated'`** (a
  `service_role` JWT as Bearer must be rejected — it would bypass RLS).
  Reject before any I/O. `auth.getUser()` optionally after, for revocation.
- **Per-request client (9):** construct the supabase-js client inside the
  request handler on every invocation. Nothing token-derived at module
  scope — Edge isolates are reused across users.
- **Consent page anti-clickjacking (5):** frame-bust in JS
  (`window.top !== window.self` → render nothing clickable) +
  `<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">`.
  GitHub Pages cannot send the real header.
- **`redirect_url` validation (6):** parse with `new URL()`; allow
  `https:` only (plus `http://localhost` in dev); allowlist the expected
  Anthropic callback host and warn on anything else; navigate with
  `location.assign()`. Never `window.location.href =` raw.
- **No open DCR (7):** dynamic client registration stays **off**.
  Pre-register a single public OAuth client for Claude with exact redirect
  URIs. (If DCR is ever enabled, the consent screen must present the
  redirect-URI host — not the attacker-chosen client name — as the primary
  identity signal.)

### Hardening (required in implementation)

- `set_item_in_cart` updates a hardcoded projection only
  (`{ is_in_cart: boolean }`); UUID-validate `item_id` (finding 10 —
  `li_update` RLS allows members to update any column).
- **Prompt-injection containment (11):** wrap all user/catalog-derived
  strings in tool results in explicit untrusted-data delimiters; tool
  descriptions state list content is data, never instructions. (Elevated
  priority: users' Claude accounts may have Gmail/Drive connectors.)
- Map Postgres errors to generic Hebrew messages; never relay raw errors or
  log the Authorization header (15).
- Consent-page hygiene (15): stash `authorization_id` in `sessionStorage`
  across the login hop, strip it via `history.replaceState` after use,
  never auto-approve — always an explicit click.
- Rate limiting (12): reject unauthenticated junk before any network call
  (free via local JWT check); per-user token bucket on mutating tools —
  in-isolate `Map` acceptable at household scale.
- **Never set the `app.service_role_key` GUC** (finding 13):
  `refresh_products_now` reads it and would expose it to SQL contexts; if
  that function is ever revived, use Supabase Vault instead.
- Revocation: dashboard-level revocation is not accessible to household
  users; acknowledged gap — an in-app "disconnect Claude" can come later.

- **No secrets in the connector URL.** The connector URL is public and safe
  to share; identity comes only from OAuth tokens.

## Out of scope (deliberate)

- Deleting/editing items, list creation/archival, sharing management,
  checkout/purchase history — the app remains the place for those.
- Restricting which Google accounts may attempt OAuth (once the prerequisite
  DB hardening lands, RLS yields zero data for strangers; an allowlist can be
  added later if noise appears).
- Any change to the official admin connector Avita uses for development.

## Testing

1. **Protocol smoke test:** scripted JSON-RPC calls against the deployed
   function with a real user JWT (initialize, tools/list, each tool).
2. **Authorization test:** expired token → 401; second user without shared
   lists → `get_lists` returns empty; second user with a shared list → sees
   only that list; `set_item_in_cart` on a foreign item → RLS error.
3. **Security tests (from Eli's review):** two different users hitting the
   same warm isolate back-to-back (no token bleed); a `service_role` JWT as
   Bearer → rejected; a `javascript:`/foreign-host `redirect_url` → rejected;
   consent page inside an iframe → refuses to render; re-run the
   impersonation queries confirming findings 1–3 are closed;
   `get_advisors(security)` clean of the flagged issues.
4. **End-to-end:** add the connector in a real Claude account (second Google
   user), run the OAuth flow, add an item in Hebrew, verify it appears in the
   app in the correct department in realtime.

## Delivery

- **Phase 0 (prerequisite):** DB hardening migration (Eli findings 1–3 +
  drift reconciliation, finding 14) — applied and verified before any
  connector code. Worth shipping even if the connector never does.
- New: `supabase/functions/mcp-shopping/index.ts`, `src/components/OAuthConsent.tsx`.
- Modified: `App.tsx` (query-param branch), version bump in `package.json` +
  UI version label (per user preference).
- Dashboard (manual, documented in the plan): enable OAuth server (DCR stays
  **off**), pre-register the Claude OAuth client, set Authorization Path.

---

## Post-implementation review (Eli, 2026-08-15) — outcome

Findings 1-3 from the design review were re-verified as genuinely closed against
the live database (impersonation as a real user with zero lists: `ingest_batch`
and the three ingestion tables blocked with 42501; `v_list_participants`
returned 0 rows and 0 emails). `participant_email` was scrutinised as a possible
new leak path and cleared — it returns non-NULL only for the caller or a genuine
co-member, and needs an unguessable UUID. `ShareDialog` still works for real
users. The connector's own implementation requirements (findings 5-10) were
confirmed present and effective in code, not merely commented.

### Fixed in response to the second review

- **Anonymous identities rejected** (`auth.ts`). Anonymous sign-ups carry
  `role === 'authenticated'`, so the role check alone let any stranger holding
  the public anon key mint a token this endpoint served. Now
  `is_anonymous === true` is a hard reject. Proven by a test that creates a real
  anonymous token, asserts its claims, and asserts the connector returns 401.
- **Consent screen no longer overstates the sandbox.** It previously claimed the
  app "cannot delete items or lists". That was false: the token is a full app
  identity (finding 4) and can reach PostgREST directly — including, on this
  shared project, ProjectsManagerWeb's tables. The text now says the grant is
  the account's full permissions and is not technically limited to the tools.
- **Redirect host judged before the grant is issued.** Approval previously ran
  first and validation second, so an unknown-host warning appeared only after a
  grant already existed server-side. The host is now evaluated from
  `redirect_uri` at load time; an untrusted host renders a red warning with
  "reject" as the primary action. `safeRedirect` remains as an https-only second
  line of defense. (This was low-risk while DCR is off; it is a prerequisite for
  ever turning DCR on.)
- **Dependencies pinned** — `deno.json` floated on major versions, putting an
  unreviewed `jose` release on the JWT verification path at cold start.
- **`unit` wrapped** in `get_list_items` output; it was the one user-derived
  field escaping the untrusted-data delimiters.
- **Test suite tightened.** The `anon key as Bearer` test never exercised the
  role check (the anon key dies at signature verification), so deleting the role
  line would have left the suite green. Added a genuine anonymous-token test and
  a delimiter-breakout test; removed vacuous assertions that passed on HTTP 500
  or on an empty array. Suite is now 30 assertions, all passing.

### Open issues — pre-existing, project-wide, NOT introduced by the connector

1. **`shopping.set_department_override` lets any authenticated user rewrite the
   global product→department mapping** (`SECURITY DEFINER`, checks only that
   `auth.uid()` is not null, `on conflict (barcode) do update`). Verified live.
   The app uses this for a real user feature (`ShoppingListView.tsx`), so the
   fix is a product decision, not a mechanical one: restrict to `app_admins`
   (removes the feature for normal users) or convert to per-user overrides
   (preserves it; more work). Until then, any signed-up user can degrade
   category sorting and smart-route for everyone.
2. **Anonymous sign-ins are enabled** at the project level and the app never
   uses them (`signInAnonymously` appears nowhere in `src/`). They should be
   turned off in the dashboard; the connector already rejects them, but they
   remain a free path to an `authenticated` role for the rest of the project.
   Note: while enabled, each run of the test suite creates one anonymous user;
   once disabled, the test takes its self-reporting "path closed" branch.
3. **Catalog tables still carry INSERT/UPDATE/DELETE grants to `authenticated`**
   (`products`, `product_prices`, `product_departments`, `chains`,
   `refresh_log`, `app_admins`). Harmless today — no permissive policy exists,
   so writes affect 0 rows — but one careless `for all using (true)` away from
   catalog poisoning. Migration 0020's default-privilege change only covers
   tables created in future.
4. **No auth-failure logging** on a public `verify_jwt=false` endpoint: no
   signal for probing or credential stuffing.

### Must verify once the OAuth server is enabled

Every test to date used ordinary Google-login session JWTs. OAuth-server-issued
access tokens have never existed on this project. The auth gate assumes they
carry `aud: authenticated`, `role: authenticated`, and
`iss: https://<ref>.supabase.co/auth/v1`. If the OAuth server instead sets `aud`
to the client_id or a resource indicator (RFC 8707), verification fails closed —
the connector simply will not work, which is the safe direction, but decode the
first real token and confirm before debugging blind.
