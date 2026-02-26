---
id: task.0112
type: task
title: "SIWE zero-flash: immediate post-sign navigation"
status: needs_implement
priority: 0
rank: 12
estimate: 1
summary: "Eliminate the visual flash where SIWE wallet sign-in briefly shows the homepage before redirecting to /chat. RainbowKit uses signIn(credentials, redirect false) so NextAuth redirect callback never fires."
outcome: SIWE sign-in navigates to /chat immediately after session is established — no homepage flash, no visible WalletConnect modal after auth completes.
spec_refs: authentication-spec
assignees: unassigned
credit:
project: proj.decentralized-identity
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0111
deploy_verified: false
created: 2026-02-26
updated: 2026-02-26
labels: [identity, auth, frontend, ux]
external_refs:
---

# SIWE Zero-Flash: Immediate Post-Sign Navigation

## Context

After SIWE wallet sign-in completes, the user briefly sees the homepage (with WalletConnect modal still visible) before `AuthRedirect`'s `useEffect` fires `router.replace("/chat")`. This is a ~200-500ms flash.

**Root cause:** RainbowKit calls `signIn("credentials", { redirect: false })` internally. NextAuth's `redirect` callback never fires for credentials providers with `redirect: false`. The page was server-rendered as anonymous, so the already-painted homepage is visible until React's client-side effect runs.

**Dependency:** task.0111 creates `/sign-in` and middleware. With middleware in place, the primary SIWE entry point moves from `/` to `/sign-in`. This task ensures the post-SIWE navigation from `/sign-in` to `/chat` is instant.

## Requirements

- After SIWE sign-in succeeds on `/sign-in`, user navigates to `/chat` immediately — no render cycle delay.
- The WalletConnect/RainbowKit modal does not remain visible after auth completes.
- No regression on OAuth flows (they use NextAuth's `redirect` callback and are unaffected).
- Add a Playwright e2e smoke test: SIWE login lands on `/chat` without painting the public homepage.

## Allowed Changes

- `src/app/(auth)/sign-in/page.tsx` — SIWE completion handler (created by task.0111)
- `src/app/(public)/AuthRedirect.tsx` — may be simplified or removed if middleware + sign-in page handle all cases
- `src/app/providers/wallet.client.tsx` — if RainbowKit SIWE config needs `onSuccess` callback wiring
- `tests/e2e/` or `tests/playwright/` — new smoke test

## Plan

- [ ] Investigate RainbowKit SIWE `onSuccess` / `onSignIn` callback — can we hook `router.replace("/chat")` directly into SIWE completion instead of relying on `useSession` polling?
- [ ] Wire immediate navigation in the sign-in page's SIWE flow (either via RainbowKit callback or by watching session status with a tighter mechanism than `useEffect`)
- [ ] Verify WalletConnect modal dismisses on auth success
- [ ] Evaluate whether `AuthRedirect.tsx` is still needed (middleware handles unauthed→`/sign-in`; SIWE callback handles `→/chat`) — simplify or remove if redundant
- [ ] Add Playwright e2e test: SIWE login → lands on `/chat` without homepage flash
- [ ] Run `pnpm check` + `pnpm test`

## Validation

**Commands:**

```bash
pnpm check            # types + lint clean
pnpm test             # unit tests pass
pnpm test:e2e         # playwright smoke test passes (if e2e infra exists)
```

**Manual smoke test:**

1. Go to `/sign-in` → connect wallet → sign SIWE message → immediately on `/chat` (no flash)
2. OAuth sign-in still works (unaffected)
3. Sign out → lands on `/sign-in`

## Review Checklist

- [ ] **Work Item:** `task.0112` linked in PR body
- [ ] **Spec:** WALLET_SESSION_COHERENCE preserved
- [ ] **Tests:** e2e smoke test for SIWE → `/chat` transition
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
