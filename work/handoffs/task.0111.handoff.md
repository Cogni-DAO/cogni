---
id: task.0111.handoff
type: handoff
work_item_id: task.0111
status: active
created: 2026-02-28
updated: 2026-03-01
branch: feat/oauth-signin
last_commit: d64e96ff
---

# Handoff: Auth UX — SignInDialog, Account Linking, Profile

## Context

- Users sign in via a **SignInDialog** modal (wallet SIWE + OAuth) triggered from the header Connect button — not a standalone page.
- Account linking lets an authenticated user bind additional OAuth providers (GitHub/Discord/Google) to their existing identity.
- Linking uses a **DB-backed fail-closed** flow: `link_transactions` table is the authority, consumed atomically in the signIn callback.
- Server-side auth routing lives in `src/proxy.ts` (single routing authority). Client-side redirects were removed from `(app)/layout.tsx`.
- PR: https://github.com/Cogni-DAO/node-template/pull/496

## Current State

- **Working:** SignInDialog, OAuth sign-in, SIWE sign-in, proxy routing, profile page UI, ProviderIcons, all `pnpm check` passes.
- **Broken: Account linking from profile page.** Two bugs in `src/app/api/auth/[...nextauth]/route.ts`:

### Bug 1: Handler crashes on non-callback routes

The `[...nextauth]/route.ts` handler wraps **every** NextAuth route (`/providers`, `/session`, `/signout`, `/callback/*`, `/_log`) with link-intent logic. When a `link_intent` cookie is present, the handler tries `response.cookies.set(...)` to clear it — but routes like `/providers`, `/signout`, and `/_log` return objects **without a `.cookies` accessor**. This crashes with `TypeError: Cannot read properties of undefined (reading 'set')`.

The crash cascades: after one failed link attempt, the cookie persists (`path: "/"`, 5-min TTL) and **every subsequent NextAuth request crashes** — including `/providers`, `/signout`, and `/session`. This puts the app in a broken state where the user appears both signed-in and signed-out simultaneously.

### Bug 2: Link endpoint was using GET redirect (fixed, committed)

The original link endpoint redirected to `GET /api/auth/signin/{provider}`. But `pages.signIn: "/"` in auth config causes NextAuth to redirect that GET to `/` instead of starting OAuth. Fixed in commit `382a98cb`: endpoint is now POST-only, returns JSON, and the profile page calls `signIn()` from `next-auth/react` client-side.

### Uncommitted fix on disk

An **untested** fix exists in the working tree for Bug 1: scopes link-intent logic to callback routes only via `isCallbackRoute()`. The committed code is still the broken version. **Review this fix carefully before committing** — verify that NextAuth's callback route actually returns a NextResponse with `.cookies`.

## Decisions Made

- [auth spec](../../docs/spec/authentication.md): LINK_IS_FAIL_CLOSED, SINGLE_ROUTING_AUTHORITY invariants
- [identity spec](../../docs/spec/decentralized-user-identity.md): linkTransactions schema, linking flow
- Link endpoint is POST-only. Client calls `fetch(POST /api/auth/link/{provider})` then `signIn(provider)` — same pattern as SignInDialog.
- `pages.signIn: "/"` means all OAuth initiation must go through `signIn()` from `next-auth/react`. Server-side redirects to `/api/auth/signin/*` do not work.
- DB tx over session-token-hash: `link_transactions` table is single source of truth, atomically consumed.
- `getServiceDb` stays in `auth.ts` (dep-cruiser constraint).

## Next Actions

- [ ] Fix Bug 1: make `[...nextauth]/route.ts` only run link-intent logic on callback routes
- [ ] Verify fix: clear cookies → sign in → link GitHub → should land on `/profile?linked=github`
- [ ] Verify sign-out works cleanly with no stale cookie crash
- [ ] Consider narrowing cookie `path` from `/` to `/api/auth/callback` to limit blast radius
- [ ] Run `pnpm check` after fix
- [ ] Clean up messy revert history (squash before merge)
- [ ] Commit, push, update PR

## Risks / Gotchas

- **NextAuth v4 response types are not uniform.** `/callback/*` returns NextResponse (redirect). `/providers`, `/session`, `/_log` return plain objects. Do not assume `.cookies` exists on all.
- **`pages.signIn: "/"` is the root cause of the GET redirect failure.** Do not attempt server-side redirects to `/api/auth/signin/*`.
- **Migration 0019** creates `link_transactions` table. Must run `pnpm db:setup` or `pnpm db:migrate` before linking works.
- **Revert commit history is messy** — multiple reverts from debugging. Squash before merge.
- **Stale dev server cache**: Next.js dev server may serve old compiled code. Restart `next dev` if error line numbers don't match the file on disk.

## Pointers

| File / Resource                                                 | Why it matters                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/app/api/auth/[...nextauth]/route.ts`                       | **THE BROKEN FILE** — crashes on non-callback routes when link_intent cookie present |
| `src/app/api/auth/link/[provider]/route.ts`                     | Link setup endpoint (POST). Creates DB row, sets cookie, returns JSON                |
| `src/app/(app)/profile/page.tsx`                                | Link button calls `fetch(POST)` then `signIn()` from next-auth/react                 |
| `src/auth.ts`                                                   | NextAuth config, signIn callback, `createLinkTransaction`, `consumeLinkTransaction`  |
| `src/shared/auth/link-intent-store.ts`                          | AsyncLocalStorage + discriminated union types for link intent                        |
| `src/components/kit/auth/SignInDialog.tsx`                      | Working sign-in modal — reference for correct `signIn()` usage                       |
| `docs/spec/authentication.md`                                   | Auth spec with invariants and flow diagrams                                          |
| `docs/spec/decentralized-user-identity.md`                      | Identity spec with linkTransactions schema                                           |
| `src/adapters/server/db/migrations/0019_supreme_black_bolt.sql` | Migration for link_transactions table with RLS                                       |
| `tests/stack/auth/oauth-signin.stack.test.ts`                   | Stack tests for signIn callback DB paths                                             |
