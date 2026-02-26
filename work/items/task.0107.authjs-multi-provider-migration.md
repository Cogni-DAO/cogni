---
id: task.0107
type: task
title: Multi-provider auth — GitHub + Discord + Google OAuth on NextAuth v4
status: done
priority: 1
rank: 10
estimate: 3
summary: Add GitHub, Discord, and Google OAuth providers to the existing NextAuth v4 setup. Resolve all providers to canonical user_id via user_bindings. Make SessionUser.walletAddress optional. No version upgrade, no new tables, no DrizzleAdapter.
outcome: Users can sign in via SIWE wallet, GitHub, Discord, or Google OAuth. All methods resolve to the same canonical user_id (UUID). SessionUser.walletAddress becomes optional. Existing SIWE login unchanged. Explicit account linking for binding additional providers to an existing user.
spec_refs: decentralized-user-identity, authentication-spec
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch: feat/user-accounts
pr: https://github.com/Cogni-DAO/node-template/pull/480
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-02-24
updated: 2026-02-24
labels: [auth, identity, oauth]
external_refs:
---

# Multi-Provider Auth — Discord + GitHub OAuth on NextAuth v4

## Design

### Outcome

Users can sign in with Discord or GitHub (in addition to SIWE wallet) and all methods resolve to the same `user_id` (UUID) identity. Non-wallet users can access the platform. Wallet-gated operations (payments, ledger approval) remain wallet-gated.

### Research Findings (Completed)

The original plan proposed Auth.js v5 + DrizzleAdapter + standard `accounts` table. Research revealed this is the wrong path:

| Finding                                                                                                                                                                       | Implication                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RainbowKit SIWE adapter incompatible with Auth.js v5** — `@rainbow-me/rainbowkit-siwe-next-auth` has explicit peer incompatibility with `next-auth@5`. No official support. | Auth.js v5 migration would require replacing RainbowKit SIWE with custom SIWE implementation — massive scope increase                                 |
| **Credentials + DrizzleAdapter = known pain point** — Auth.js v5 doesn't auto-persist Credentials users to DB. Requires manual session management workaround.                 | Even after v5 migration, SIWE (Credentials provider) wouldn't benefit from the adapter                                                                |
| **`user_bindings` already IS the accounts table** — same concept: `(provider, external_id) → user_id`, with `UNIQUE(provider, external_id)` constraint                        | Adding a separate Auth.js `accounts` table would duplicate data. `user_bindings` serves the same purpose with added audit trail via `identity_events` |
| **NextAuth v4 supports OAuth providers natively** — Discord and GitHub providers work with JWT strategy, no adapter needed                                                    | Zero version migration needed to achieve the user outcome                                                                                             |
| **walletAddress blast radius: 9 critical, 16 medium, 20+ low** — payment flows (`getAddress()`) and ledger approver guard are the biggest risks                               | These are correctly wallet-gated — non-wallet users shouldn't access payment/ledger mutations anyway                                                  |

### Approach

**Solution:** Add Discord + GitHub OAuth providers to the existing NextAuth v4 config. Use the existing `user_bindings` table as the account store. Resolve users in `signIn` callback via `user_bindings(provider, external_id)`. Call `createBinding()` for unified audit trail across all providers (SIWE + OAuth).

**Reuses:**

- NextAuth v4 (no upgrade)
- `user_bindings` table (task.0089 — already shipped)
- `identity_events` audit trail (task.0089)
- `createBinding()` utility (already supports `'wallet' | 'discord' | 'github'`)
- RainbowKit SIWE integration (unchanged)
- JWT session strategy (unchanged)

**Rejected:**

| Alternative                              | Why rejected                                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth.js v5 + DrizzleAdapter              | RainbowKit SIWE incompatible with v5. Credentials provider doesn't auto-persist with adapter. Massive scope increase for zero user-facing value. Migrate to v5 later when RainbowKit adds support.                   |
| Separate `accounts` table                | `user_bindings` already serves this purpose with `(provider, external_id) → user_id`. Adding Auth.js `accounts` would duplicate data and create two sources of truth for "which providers are linked to which user." |
| Keep walletAddress required + skip OAuth | Blocks Discord/GitHub-first users entirely. Contradicts the identity spec's `CANONICAL_IS_USER_ID` invariant.                                                                                                        |

### Invariants

- [ ] CANONICAL_IS_USER_ID: App logic keys off `user_id` only; wallet is an attribute, never "the identity" (spec: decentralized-user-identity)
- [ ] IDENTITIES_ARE_BINDINGS: Every login method resolved via `user_bindings(provider, external_id)`; wallet = `provider="wallet"`, discord = `provider="discord"`, github = `provider="github"` (spec: decentralized-user-identity)
- [ ] LINKING_IS_EXPLICIT: Linking only when already authenticated; new OAuth login with unknown external_id creates a new user. `UNIQUE(provider, external_id)` prevents same account bound to two users. (spec: decentralized-user-identity, NO_AUTO_MERGE)
- [ ] AUDIT_APPEND_ONLY: `createBinding()` called for all providers — every link has proof in `identity_events` (spec: decentralized-user-identity, BINDINGS_ARE_EVIDENCED)
- [ ] SIWE_UNCHANGED: Existing SIWE login/logout/wallet-switch flows continue working. RainbowKit integration untouched. (spec: authentication-spec)
- [ ] WALLET_GATED_OPS: Payment creation and ledger approval still require `walletAddress`. Non-wallet users get clean 403s. (spec: authentication-spec, epoch-ledger)
- [ ] SIMPLE_SOLUTION: No version upgrade, no new tables, no adapter. Leverages existing v4 + user_bindings. (principle: SIMPLICITY_WINS)

### Auth Flow Design

**SIWE Login (unchanged):**

```
RainbowKit → SIWE Verify → users lookup by wallet_address → createBinding("wallet", address) → JWT { id, walletAddress }
```

**Discord/GitHub OAuth Login (new):**

```
NextAuth OAuth → signIn callback → user_bindings lookup by (provider, providerAccountId)
  → IF binding exists: return existing user.id
  → IF no binding: create new user → createBinding(provider, providerAccountId, evidence) → return new user.id
  → jwt callback: { id, walletAddress: null }
```

**Account Linking (new — authenticated user adds provider):**

```
Authenticated user → hits /api/auth/link/discord (requires existing session)
  → server sets HttpOnly cookie: link_intent=<signed nonce> (nonce→user_id stored server-side or in signed JWT)
  → server redirects to NextAuth's /api/auth/signin/discord (standard CSRF state preserved)
  → signIn callback reads link_intent cookie → binds provider to EXISTING user via createBinding()
  → clears link_intent cookie
  → IF binding already exists for different user → reject (NO_AUTO_MERGE)
```

**Why not custom OAuth state?** NextAuth generates/validates OAuth `state` for CSRF protection. Injecting custom data would break CSRF validation. The HttpOnly cookie approach is safe because the linking endpoint requires an authenticated session before setting the cookie.

### Files

**Modified (Steps 1-3, GitHub-only v0):**

- `src/auth.ts` — added `GitHubProvider`, `signIn` callback (user_bindings resolution, atomic new-user tx, link-intent detection, race-safe UNIQUE handling), explicit jwt/session token plumbing
- `src/shared/auth/session.ts` — `SessionUser.walletAddress: string | null`
- `src/lib/auth/server.ts` — `getServerSessionUser()` requires only `id`
- `src/app/_facades/payments/attempts.server.ts` — `WalletRequiredError` guard before `getAddress()`, conditional spreads
- `src/app/_facades/payments/credits.server.ts` — conditional spreads for walletAddress
- `src/app/api/v1/payments/intents/route.ts` — `WalletRequiredError` → 403 handler
- `src/app/api/v1/governance/activity/route.ts` — system principal: `walletAddress: null`
- `src/app/api/v1/ledger/_lib/approver-guard.ts` — accept `string | null | undefined`
- `src/app/api/auth/[...nextauth]/route.ts` — wrapped with `AsyncLocalStorage.run()` for link_intent cookie propagation
- `src/app/_lib/auth/session.ts` — doc comment update
- `.env.local.example` — `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `tests/_fixtures/auth/synthetic-session.ts` — walletAddress optional
- `src/features/payments/errors.ts` — added `WalletRequiredError`

**Created:**

- `src/shared/auth/link-intent-store.ts` — `AsyncLocalStorage<LinkIntent | null>`, pure shared primitive
- `src/app/api/auth/link/[provider]/route.ts` — account-linking initiation (session-bound signed JWT cookie, 5min TTL, redirects to OAuth)
- `tests/unit/auth/oauth-signin-branches.test.ts` — unit tests for signIn early-return branches + WalletRequiredError guard
- `tests/stack/auth/oauth-signin.stack.test.ts` — stack tests for signIn DB paths (new user, returning user, linking, NO_AUTO_MERGE)

**Not modified (no change needed):**

- `src/types/next-auth.d.ts` — already has `walletAddress?: string | null`

### Implementation Notes

**Scope reduction:** This implementation is GitHub-only v0. Discord provider deferred to follow-up PR.

**Architecture decision — link_intent cookie propagation:** NextAuth v4's `signIn` callback receives `{ user, account, profile }` — no `req`, no cookies. Solution: `AsyncLocalStorage` in `[...nextauth]/route.ts` reads the `link_intent` cookie, populates the store, and the `signIn` callback reads it via `linkIntentStore.getStore()`. The store lives in `src/shared/auth/` (not `src/lib/`) to satisfy dependency boundary rules (`auth` → `shared` is allowed).

**Safety hardening:**

1. **Session binding:** link_intent JWT includes `sessionTokenHash` — prevents replay by different session
2. **Race safety:** on UNIQUE(provider, external_id) violation, re-fetch binding and proceed idempotently if same user, reject if different user (NO_AUTO_MERGE)
3. **Runtime guard:** `export const runtime = "nodejs"` on both route files — `AsyncLocalStorage` requires Node.js
4. **Cookie correctness:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300` — cleared with identical attrs in all code paths
5. **Atomicity:** new-user creation inlines user + binding + identity_event in a single DB transaction

## Requirements

- Discord OAuth provider configured and functional for login (new user creation + returning user)
- GitHub OAuth provider configured and functional for login (new user creation + returning user)
- SIWE login unchanged — RainbowKit integration untouched
- All providers resolve to canonical `user_id` via `user_bindings` lookup
- `createBinding()` called for OAuth providers (evidence includes OAuth profile metadata)
- `SessionUser.walletAddress` is `string | null` — no longer required
- `getServerSessionUser()` returns valid session when only `id` is present (no wallet)
- Payment creation returns clean 403 if `walletAddress` is null (not a crash)
- Ledger approver guard continues working (already handles null → 403)
- Account linking: authenticated user can trigger OAuth to bind new provider to existing account
- `UNIQUE(provider, external_id)` constraint prevents same OAuth account bound to two users (NO_AUTO_MERGE)
- `identity_events` has `bind` event for each new OAuth binding
- Authentication spec updated

## Allowed Changes

- `src/auth.ts` — providers, signIn callback, jwt/session callbacks
- `src/shared/auth/session.ts` — SessionUser type
- `src/lib/auth/server.ts` — getServerSessionUser guard
- `src/app/_facades/payments/attempts.server.ts` — walletAddress null check
- `src/app/api/v1/governance/activity/route.ts` — system principal cleanup
- `src/adapters/server/identity/create-binding.ts` — no change needed (already supports discord/github)
- `docs/spec/authentication.md` — invariant update
- `.env.local.example` — OAuth env vars
- `tests/_fixtures/auth/` — test helpers
- New: `src/app/api/auth/link/` — linking route
- New: `tests/unit/auth/` — multi-provider tests

## Plan

### Step 1: Types & guards (no runtime behavior change) — DONE

- [x] Change `SessionUser.walletAddress` from `string` to `string | null` in `src/shared/auth/session.ts`
- [x] Update `getServerSessionUser()` in `src/lib/auth/server.ts` to require only `id`
- [x] Add `WalletRequiredError` guard on `getAddress()` call in `src/app/_facades/payments/attempts.server.ts` → clean 403
- [x] Add `WalletRequiredError` handler in `src/app/api/v1/payments/intents/route.ts`
- [x] Conditional spread for `walletAddress` in all payment facades (`exactOptionalPropertyTypes`)
- [x] Ledger approver guard: accept `string | null | undefined`
- [x] Clean up system principal in governance activity route (`walletAddress: null` instead of `""`)
- [x] Update test fixtures (`tests/_fixtures/auth/synthetic-session.ts`) for optional walletAddress
- [x] Update doc comments in `src/app/_lib/auth/session.ts`
- [x] `pnpm typecheck` + `pnpm arch:check` + `pnpm lint:fix` — all pass

### Step 2: GitHub OAuth provider + callbacks — DONE (GitHub only; Discord deferred)

- [x] Add `GitHubProvider` to `src/auth.ts` providers array
- [x] Add `signIn` callback: SIWE passthrough, `user_bindings` lookup for returning users, atomic new-user creation (single tx: user + binding + event)
- [x] Link-intent detection in signIn callback via `linkIntentStore.getStore()` (shared primitive)
- [x] Race-safe UNIQUE violation handling (re-fetch + idempotent check vs NO_AUTO_MERGE)
- [x] Explicit `jwt` callback: `token.id` and `token.walletAddress` always set from `user`
- [x] Explicit `session` callback: `session.user.id` and `session.user.walletAddress` always set from `token`
- [x] Add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` to `.env.local.example`

### Step 3: Account linking endpoint — DONE

- [x] Create `src/shared/auth/link-intent-store.ts` — `AsyncLocalStorage<LinkIntent | null>`, pure primitive (only imports `node:async_hooks`), no arch boundary violations
- [x] Wrap `src/app/api/auth/[...nextauth]/route.ts` — reads `link_intent` cookie, decodes signed JWT, verifies `sessionTokenHash`, populates `linkIntentStore.run()`, clears cookie in all cases. `export const runtime = "nodejs"`.
- [x] Create `src/app/api/auth/link/[provider]/route.ts` — requires session, signs 5-min TTL JWT (`userId + sessionTokenHash + purpose`), sets `HttpOnly; Secure; SameSite=Lax; Path=/` cookie, redirects to `/api/auth/signin/{provider}`. `export const runtime = "nodejs"`.
- [x] `pnpm typecheck` + `pnpm arch:check` + `pnpm lint:fix` — all pass

### Step 4: Spec + tests — DONE

- [x] Update `docs/spec/authentication.md`: multi-provider auth flows, invariants, file pointers, acceptance checks
- [x] Update `docs/spec/decentralized-user-identity.md`: OAuth auth flows, session type, file pointers, acceptance checks
- [x] Write unit tests: SIWE passthrough, null account, unknown provider rejection, WalletRequiredError guard
- [x] Write stack tests: new GitHub user (atomic), returning user, link-intent binding, idempotent link, NO_AUTO_MERGE rejection
- [ ] Manual smoke test with real GitHub OAuth app (untested end-to-end)

## Validation

**Automated:**

```bash
pnpm check          # types + lint (SessionUser changes compile clean)
pnpm test           # unit tests pass (including new multi-provider tests)
pnpm check:docs     # docs metadata valid
```

**Manual / Stack Test:**

1. SIWE wallet login → user created, session has `id` + `walletAddress` (existing flow unchanged)
2. Discord OAuth login → new user created, session has `id`, `walletAddress` is null
3. GitHub OAuth login → new user created, session has `id`, `walletAddress` is null
4. Same Discord login again → same user returned (idempotent via `user_bindings` lookup)
5. Logged in with wallet → "Link Discord" → OAuth → `createBinding("discord", ...)` for existing user
6. Attempt to link a Discord already bound to another user → rejected (UNIQUE constraint)
7. `identity_events` has `bind` events for each provider link
8. Wallet disconnect/switch still invalidates session (WALLET_SESSION_COHERENCE preserved)
9. Non-wallet user attempts payment → clean 403 (not a crash)
10. Non-wallet user attempts ledger approval → clean 403 (already works)

## Scope Boundary

- No Auth.js v5 migration (RainbowKit SIWE incompatible — defer until supported)
- No DrizzleAdapter (JWT strategy + user_bindings is sufficient)
- No new database tables (user_bindings + identity_events already exist)
- No merge/conflict resolution workflow (P1)
- No admin binding review tooling (P1)
- No Apple OAuth (P2 — requires team ID, key ID, private key file, form_post response mode; more setup than other providers)
- No DID minting or VC export (P2)
- No sign-in page UI redesign (can use NextAuth default pages initially; custom UI is a follow-up)
- No email/password provider

## Review Checklist

- [ ] **Work Item:** `task.0107` linked in PR body
- [ ] **Spec:** CANONICAL_IS_USER_ID, IDENTITIES_ARE_BINDINGS, LINKING_IS_EXPLICIT, AUDIT_APPEND_ONLY, SIWE_UNCHANGED, WALLET_GATED_OPS all upheld
- [ ] **Spec:** authentication.md updated (no longer wallet-canonical)
- [ ] **Tests:** new tests cover OAuth login, account linking, NO_AUTO_MERGE, null-wallet payment denial
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent project: proj.decentralized-identity (P0 deliverable)
- Depends on: task.0089 (user_bindings schema — done)
- Spec: docs/spec/decentralized-user-identity.md
- Spec: docs/spec/authentication.md
- Handoff: [handoff](../handoffs/task.0107.handoff.md)

## Review Feedback (revision 2)

### Blocking Issues

1. **New-user transaction race condition** (`src/auth.ts:265-291`): `onConflictDoNothing` on binding insert but unconditional `identity_events` insert. On concurrent first-login for the same GitHub account, creates orphaned users + phantom events. **Fix:** Use `.returning()` pattern from `createBinding()` utility — only insert event if binding was actually inserted. Handle the skipped-binding case (re-fetch existing binding's userId, use that instead of creating a new user, or abort the transaction).

2. **Catch-all error swallowing in link-intent** (`src/auth.ts:223`): The `catch` block catches ALL errors from `createBinding()` and treats them as UNIQUE constraint races — DB connection failures, FK violations, timeouts all silently rejected. **Fix:** Check for Postgres error code `23505` (unique_violation) before race-check path; re-throw unknown errors.

3. **`pnpm check` failures**:
   - `format`: this work item markdown needs `pnpm format --write`
   - `check:docs`: `src/app/api/auth/[...nextauth]/route.ts` header Scope missing negative clause (DH004)

4. **No tests** (Step 4): Zero coverage for critical paths (OAuth user creation, returning user, link flow, NO_AUTO_MERGE, null-wallet 403).

### Non-blocking suggestions

- Conditionally register GitHub provider only when env vars are non-empty
- Use `new URL()` constructor in link route redirect
- Clean up double-cast `user as unknown as Record<string, unknown>` → single cast through augmented `User` type
- Update `src/shared/auth/AGENTS.md` Public Surface + Notes for nullable walletAddress
- Update `src/app/_lib/auth/session.ts` doc Notes — still says "wallet-first session model"

## Attribution

-
