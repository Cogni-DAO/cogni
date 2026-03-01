---
id: task.0111.handoff
type: handoff
work_item_id: task.0111
status: active
created: 2026-02-28
updated: 2026-03-01
branch: feat/oauth-signin
last_commit: 0c4e0b16
---

# Handoff: Auth UX — SignInDialog, Account Linking, Profile

## Context

- Users sign in via a **SignInDialog** modal (wallet SIWE + OAuth) triggered from the header — not a standalone page.
- Account linking lets an authenticated user bind additional OAuth providers (GitHub/Discord/Google) to their existing identity.
- Linking uses a **DB-backed fail-closed** flow: `link_transactions` table is the authority, consumed atomically in the signIn callback.
- Server-side auth routing lives in `src/proxy.ts` (single routing authority).
- PR: https://github.com/Cogni-DAO/node-template/pull/496

## Current State

- **Working:** SignInDialog, OAuth sign-in, SIWE sign-in, proxy routing, ProviderIcons, link-intent cookie fix (callback-scoped path + `isCallbackRoute` guard + raw `Set-Cookie` header clearing). All `pnpm check` passes locally. Manual testing confirms linking works end-to-end.
- **Broken: CI production build fails** on `/profile` page. `useSearchParams()` in `profile/page.tsx` crashes Next.js static prerendering with `useSearchParams() should be wrapped in a suspense boundary`. This is a regression introduced by this branch.
- **Pre-existing:** `/gov`, `/work`, `/activity` also use `useSearchParams()` in client views but happen to build on staging. Their `page.tsx` files are server components importing client `view.tsx` files. They lack explicit `<Suspense>` boundaries too — fragile but not currently breaking.

### Required fix: split profile into server page + client view

The codebase convention is `page.tsx` (server shell) + `view.tsx` (`"use client"` with hooks). Every other `(app)` page follows this: `gov/page.tsx` → `gov/view.tsx`, `activity/page.tsx` → `activity/view.tsx`, `work/page.tsx` → `work/view.tsx`. Profile is the outlier — it has `"use client"` directly on `page.tsx`.

**Fix:** Move all client code from `profile/page.tsx` into a new `profile/view.tsx` (exported as `ProfileView`). Rewrite `page.tsx` as a server component wrapping the view in `<Suspense fallback={null}>`:

```tsx
import { Suspense } from "react";
import { ProfileView } from "./view";

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileView />
    </Suspense>
  );
}
```

This matches both the codebase convention and Next.js guidance for `useSearchParams()`.

## Decisions Made

- [auth spec](../../docs/spec/authentication.md): LINK_IS_FAIL_CLOSED, SINGLE_ROUTING_AUTHORITY invariants
- [identity spec](../../docs/spec/decentralized-user-identity.md): linkTransactions schema, linking flow
- Link endpoint is POST-only (`src/app/api/auth/link/[provider]/route.ts`). Client calls `fetch(POST)` then `signIn(provider)`.
- Cookie path scoped to `/api/auth/callback` — non-callback NextAuth routes never see it.
- Cookie cleared via raw `Set-Cookie` header, not `response.cookies.set()` — works for any Response type.
- `isCallbackRoute()` guard in `[...nextauth]/route.ts` — link-intent decode + clear only runs on callback routes.

## Next Actions

- [ ] Split `profile/page.tsx` into server `page.tsx` + client `view.tsx` with `<Suspense>` wrapper (see "Required fix" above)
- [ ] Run `pnpm build` to confirm `/profile` renders as `○ (Static)` without errors
- [ ] Run `pnpm check` — must pass clean
- [ ] Push and confirm CI `stack-test` job passes (Docker build is where the failure occurs)
- [ ] Update file header on new `view.tsx` per `docs/templates/header_source_template.ts`

## Risks / Gotchas

- **The CI failure is in the Docker build step** (`pnpm build` inside Docker), not in tests. Local `pnpm check` passes because it doesn't run `pnpm build`.
- **`/gov`, `/work`, `/activity` lack `<Suspense>` boundaries too.** They build today because their `page.tsx` are server components, but this is fragile. Consider adding `<Suspense fallback={null}>` wrappers to those pages too as a follow-up.
- **Migration 0019** creates `link_transactions` table. Must run `pnpm db:setup` or `pnpm db:migrate` before linking works.
- **4 pre-existing stack test failures** in `oauth-signin.stack.test.ts` — DB isolation issue (duplicate keys from test 1 leaking to later tests). Not introduced by this branch.

## Pointers

| File / Resource                               | Why it matters                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/app/(app)/profile/page.tsx`              | **THE FILE TO SPLIT** — `"use client"` page crashes Next.js static prerender        |
| `src/app/(app)/gov/page.tsx`                  | Reference for correct server page + client view pattern                             |
| `src/app/api/auth/[...nextauth]/route.ts`     | Link-intent guard and cookie clearing (fixed, committed)                            |
| `src/app/api/auth/link/[provider]/route.ts`   | Link setup endpoint (POST). Cookie path = `/api/auth/callback`                      |
| `src/auth.ts`                                 | NextAuth config, signIn callback, `createLinkTransaction`, `consumeLinkTransaction` |
| `src/shared/auth/link-intent-store.ts`        | AsyncLocalStorage + discriminated union types for link intent                       |
| `docs/spec/authentication.md`                 | Auth spec with invariants and flow diagrams                                         |
| `tests/stack/auth/oauth-signin.stack.test.ts` | Stack tests for signIn callback DB paths                                            |
