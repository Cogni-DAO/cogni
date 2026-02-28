---
id: task.0111.handoff
type: handoff
work_item_id: task.0111
status: active
created: 2026-02-28
updated: 2026-02-28
branch: feat/oauth-signin
last_commit: 05d50728
---

# Handoff: Auth UX — OAuth Sign-In, Route Protection, Account Linking

## Context

- Cogni supports SIWE (wallet) + OAuth (GitHub, Discord, Google) sign-in via NextAuth v4.
- Before this branch, two client components (`AuthRedirect.tsx` and `(app)/layout.tsx`) competed for auth routing with `useSession()` — causing redirect loops during session transitions.
- Account linking relied on a JWT cookie alone. If the cookie was lost/expired, the signIn callback silently fell through to **create a new user** instead of linking — an identity-integrity failure.
- This branch adds OAuth sign-in UI, moves route protection server-side, and makes account linking fail-closed via DB-backed transactions.

## Current State

- **Done — OAuth sign-in UI:** `SignInDialog` component with WalletConnect + OAuth buttons, `ProviderIcons` shared SVG components, profile page link buttons.
- **Done — Server-side route protection:** `proxy.ts` is the single authority for auth routing. `AuthRedirect.tsx` deleted. `(app)/layout.tsx` is a pure UI shell (no `useSession`).
- **Done — Fail-closed account linking:** `link_transactions` DB table, `PendingLinkIntent`/`FailedLinkIntent` discriminated union, atomic consume via `UPDATE...WHERE...RETURNING`. Failed verification → `/profile?error=link_failed`.
- **Done — Tests:** Layout shell test rewritten, stack tests updated for new `PendingLinkIntent` shape with `seedLinkTransaction` fixture.
- **Not done — Lint cleanup:** `consumeLinkTransaction` in `auth.ts` has an unused `provider` parameter (biome warning). The parameter exists in the WHERE clause design but the Drizzle query currently matches on `id + userId` only — decide whether to add provider matching or underscore-prefix.
- **Not done — Closeout:** File headers, AGENTS.md, spec updates, work item status, and PR creation are pending.

## Decisions Made

- **Proxy over middleware:** Next.js 16 uses `proxy.ts` (not `middleware.ts`). The existing proxy already handled `/api/v1/*` auth; page routes were added to the same file. See `src/proxy.ts`.
- **No dedicated /sign-in page:** Auth UI is a dialog on the landing page rather than a separate route group. The original work item spec called for `/sign-in` but the prior developer implemented it as a dialog.
- **DB tx over session-token-hash:** The old approach hashed the session token into the link cookie for replay prevention. The new approach uses a `link_transactions` table row as the single source of truth — atomically consumed, never trusted from cookie alone.
- **getServiceDb stays in auth.ts:** The dep-cruiser arch rules restrict `getServiceDb` imports to `auth.ts` and a few other files. Both `createLinkTransaction` and `consumeLinkTransaction` live in `auth.ts` to satisfy this constraint.

## Next Actions

- [ ] Fix biome warning: unused `provider` param in `consumeLinkTransaction` (either add to WHERE clause or prefix with `_`)
- [ ] Run `pnpm format` to fix any formatting drift
- [ ] Update file headers for changed files (`/closeout` Phase 2)
- [ ] Update AGENTS.md if public surface changed (`/closeout` Phase 3)
- [ ] Update specs referenced in work item (`/closeout` Phase 4)
- [ ] Set work item status to `needs_merge`, create PR (`/closeout` Phase 5-6)
- [ ] Manual smoke tests: SIWE sign-in, OAuth sign-in, link from profile, expired link cookie rejection

## Risks / Gotchas

- **Migration 0019 includes hand-written RLS:** The `FORCE ROW LEVEL SECURITY` and `tenant_isolation` policy were appended manually to the Drizzle-generated migration. Re-running `pnpm db:generate` will NOT regenerate these — they live outside Drizzle's DDL scope.
- **Stack test assertion fix:** The NO_AUTO_MERGE test previously expected `false` but `auth.ts` returns the string `"/profile?error=already_linked"`. This was a pre-existing bug fixed in this branch.
- **Proxy matcher must stay in sync with APP_ROUTES:** If new app routes are added (e.g., `/settings`), both `APP_ROUTES` array and `config.matcher` in `proxy.ts` must be updated.

## Pointers

| File / Resource                                                 | Why it matters                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/proxy.ts`                                                  | Single authority for auth routing (page + API)                                            |
| `src/auth.ts`                                                   | `createLinkTransaction`, `consumeLinkTransaction`, signIn callback with fail-closed logic |
| `src/shared/auth/link-intent-store.ts`                          | `PendingLinkIntent` / `FailedLinkIntent` discriminated union + type guards                |
| `packages/db-schema/src/identity.ts`                            | `linkTransactions` table definition                                                       |
| `src/adapters/server/db/migrations/0019_supreme_black_bolt.sql` | Migration with RLS policy                                                                 |
| `src/app/api/auth/[...nextauth]/route.ts`                       | JWT decode → AsyncLocalStorage propagation                                                |
| `src/app/api/auth/link/[provider]/route.ts`                     | Link initiation — DB insert + cookie                                                      |
| `tests/stack/auth/oauth-signin.stack.test.ts`                   | Stack tests for signIn callback DB paths                                                  |
| `tests/_fixtures/stack/seed.ts`                                 | `seedLinkTransaction` shared fixture                                                      |
| `docs/guides/oauth-app-setup.md`                                | OAuth provider configuration guide                                                        |
