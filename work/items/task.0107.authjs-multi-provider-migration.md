---
id: task.0107
type: task
title: Multi-provider auth — Discord + GitHub OAuth on NextAuth v4
status: needs_implement
priority: 1
rank: 10
estimate: 3
summary: Add Discord and GitHub OAuth providers to the existing NextAuth v4 setup. Resolve all providers to canonical user_id via user_bindings. Make SessionUser.walletAddress optional. No version upgrade, no new tables, no DrizzleAdapter.
outcome: Users can sign in via SIWE wallet, Discord OAuth, or GitHub OAuth. All methods resolve to the same canonical user_id (UUID). SessionUser.walletAddress becomes optional. Existing SIWE login unchanged. Explicit account linking for binding additional providers to an existing user.
spec_refs: decentralized-user-identity, authentication-spec
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch:
pr:
reviewer:
revision: 0
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

- Modify: `src/auth.ts` — add Discord/GitHub providers, `signIn` callback for user resolution via `user_bindings`, `jwt`/`session` callbacks for optional walletAddress. **Footgun:** `jwt` callback must explicitly propagate `token.id → session.user.id` and `walletAddress → session.user.walletAddress`; Auth.js does not auto-forward custom fields. Never enable `allowDangerousEmailAccountLinking`.
- Modify: `src/shared/auth/session.ts` — `SessionUser.walletAddress: string | null`
- Modify: `src/lib/auth/server.ts` — `getServerSessionUser()` requires only `id`
- Modify: `src/types/next-auth.d.ts` — no change needed (already has `walletAddress?: string | null`)
- Modify: `src/app/_facades/payments/attempts.server.ts` — guard `getAddress()` call with null check (clean error for non-wallet users)
- Modify: `src/app/api/v1/governance/activity/route.ts` — system principal: `walletAddress: null` instead of `""`
- Modify: `docs/spec/authentication.md` — relax `SIWE_CANONICAL_IDENTITY`, add OAuth providers, update Non-Goals
- Modify: `.env.local.example` — add `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Modify: `tests/_fixtures/auth/synthetic-session.ts` — make walletAddress optional in test helpers
- Create: `src/app/api/auth/link/[provider]/route.ts` — account-linking API route (requires session, sets HttpOnly `link_intent` cookie, redirects to NextAuth's standard `/api/auth/signin/[provider]`)
- Test: `tests/unit/auth/multi-provider.test.ts` — OAuth user resolution, binding creation, linking, NO_AUTO_MERGE rejection

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

### Step 1: Types & guards (no runtime behavior change)

- [ ] Change `SessionUser.walletAddress` from `string` to `string | null` in `src/shared/auth/session.ts`
- [ ] Update `getServerSessionUser()` in `src/lib/auth/server.ts` to require only `id`
- [ ] Add null guard on `getAddress()` call in `src/app/_facades/payments/attempts.server.ts` (throw domain error for non-wallet users)
- [ ] Clean up system principal in governance activity route (`walletAddress: null` instead of `""`)
- [ ] Update test fixtures (`tests/_fixtures/auth/synthetic-session.ts`) for optional walletAddress
- [ ] `pnpm check` — verify all type changes compile clean

### Step 2: OAuth providers + callbacks

- [ ] Add `DiscordProvider` and `GitHubProvider` to `src/auth.ts` providers array
- [ ] Add `signIn` callback that resolves OAuth users via `user_bindings` lookup: find existing binding → return user, or create new user + `createBinding()`
- [ ] Update `jwt` callback: explicitly propagate `token.id` and `token.walletAddress` (Auth.js does not auto-forward custom fields). Never enable `allowDangerousEmailAccountLinking`.
- [ ] Update `session` callback: explicitly propagate `session.user.id` and `session.user.walletAddress` from token
- [ ] Add OAuth env vars to `.env.local.example`

### Step 3: Account linking endpoint

- [ ] Create `src/app/api/auth/link/[provider]/route.ts` — requires authenticated session, sets HttpOnly `link_intent` cookie (signed nonce mapping to user_id), redirects to NextAuth's standard `/api/auth/signin/[provider]`
- [ ] In `signIn` callback: detect `link_intent` cookie → bind provider to existing user instead of creating new user → clear cookie

### Step 4: Spec + tests

- [ ] Update `docs/spec/authentication.md`: relax `SIWE_CANONICAL_IDENTITY` to `CANONICAL_IS_USER_ID`, add OAuth to design, move "Social login providers" from Non-Goals to design
- [ ] Write tests: new OAuth user, returning OAuth user, link flow, NO_AUTO_MERGE rejection, null-wallet payment 403

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

## Attribution

-
