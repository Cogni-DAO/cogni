---
id: task.0107-handoff
type: handoff
work_item_id: task.0107
status: active
created: 2026-02-24
updated: 2026-02-24
branch: feat/user-accounts
last_commit: 5a5e63b4
---

# Handoff: Multi-Provider OAuth — Sign-In UI

## Context

- Cogni uses NextAuth v4 with JWT strategy. SIWE wallet login (via RainbowKit) is the original auth method.
- task.0107 added GitHub, Discord, and Google OAuth providers. All providers resolve to canonical `user_id` via the `user_bindings` table.
- `SessionUser.walletAddress` is now `string | null` — OAuth-only users have null wallets and cannot access payment/ledger operations.
- Account linking lets authenticated users bind additional providers to their existing identity via a signed cookie + AsyncLocalStorage flow.
- The backend is complete and reviewed. **The next step is building the sign-in UI** that presents GitHub and Google OAuth options to users.

## Current State

- **Done:** OAuth providers (GitHub, Discord, Google) conditionally registered, signIn callback with binding resolution, account linking endpoint, race-safe new-user creation, WalletRequiredError guards, DB migration for `google` provider, specs updated, unit + stack tests
- **Done:** Providers only register when env vars are set — no broken buttons when unconfigured
- **Not done:** Custom sign-in page UI (currently uses NextAuth default pages via `pages: { signIn: "/" }`)
- **Not done:** Account linking UI (backend endpoint exists at `/api/auth/link/[provider]`, no frontend trigger)
- **Not done:** Apple OAuth (deferred to P2 — requires team ID, key ID, private key)
- **Blocked by nothing** — all backend infrastructure is in place

## Decisions Made

- Auth.js v5 rejected — RainbowKit SIWE incompatible. Staying on NextAuth v4. See [task.0107 Research Findings](../items/task.0107.authjs-multi-provider-migration.md#research-findings-completed)
- No DrizzleAdapter — JWT strategy + `user_bindings` is sufficient
- SIWE Credentials provider keeps `id: "credentials"` (RainbowKit hardcodes this). See `src/auth.ts:62`
- OAuth providers use conditional registration (empty env = not shown). See `src/auth.ts:183-208`
- Link intent uses AsyncLocalStorage (NextAuth v4 signIn callback has no req access). See [authentication spec](../../docs/spec/authentication.md#design)

## Next Actions

- [ ] Build custom sign-in page with GitHub + Google OAuth buttons (replace NextAuth default)
- [ ] Add "Link GitHub" / "Link Google" buttons to user profile/settings (calls `GET /api/auth/link/{provider}`)
- [ ] Handle post-link redirect (user returns to profile after OAuth callback)
- [ ] Show linked providers in user profile (query `user_bindings` for current user)
- [ ] Display appropriate UI for OAuth-only users who hit wallet-gated features (payment, ledger)
- [ ] Discord OAuth button (backend ready, but Discord may not be user-facing yet — confirm scope)

## Risks / Gotchas

- `pages: { signIn: "/" }` in `src/auth.ts:48` redirects to root on unauthenticated access. A custom sign-in page will need this updated.
- NextAuth v4 `signIn("github")` triggers the OAuth flow. Use `signIn("discord")` and `signIn("google")` for the others. These are NextAuth provider IDs, not `user_bindings.provider` values.
- The account linking endpoint (`/api/auth/link/[provider]`) requires an active session and sets a 5-minute cookie. If the user doesn't complete OAuth in time, the link silently fails (normal login instead).
- OAuth-only users get `walletAddress: null` in session. Any UI that conditionally shows wallet-dependent features should check `session.user.walletAddress`.

## Pointers

| File / Resource                                           | Why it matters                                               |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `src/auth.ts`                                             | Provider registration, signIn/jwt/session callbacks          |
| `src/app/api/auth/[...nextauth]/route.ts`                 | Route handler with AsyncLocalStorage wrapper for link intent |
| `src/app/api/auth/link/[provider]/route.ts`               | Account linking initiation endpoint                          |
| `src/shared/auth/session.ts`                              | `SessionUser` type definition                                |
| `src/app/providers/wallet.client.tsx`                     | RainbowKit + SIWE provider wiring (existing wallet UI)       |
| `docs/spec/authentication.md`                             | Full auth spec with flow diagrams                            |
| `work/items/task.0107.authjs-multi-provider-migration.md` | Work item with review feedback history                       |
| `.env.local.example:45-60`                                | OAuth env var setup instructions                             |
