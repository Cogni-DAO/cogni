---
id: bug.0255
type: bug
title: "Node landing pages have broken sign-in flow"
status: needs_triage
priority: 1
rank: 2
estimate: 2
summary: "Poly and resy node landing pages cannot sign users in. Poly links to /api/auth/signin (bare NextAuth page). Poly's Three.js landing page is dead code (route group override). Resy homepage redirects to /chat but sign-in from landing is broken."
outcome: "Unauthenticated users on any node landing page can sign in via the same wallet/OAuth dialog used by operator."
spec_refs: []
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [auth, nodes, ux]
external_refs: []
---

# Node landing pages have broken sign-in flow

## Requirements

### Observed

**Poly (:3100):** Sign-in buttons link to `/api/auth/signin` — renders
NextAuth's bare default provider page, not the app's wallet/OAuth dialog.

Additionally, poly's custom Three.js landing page (`src/app/page.tsx` at L12-17:
Header, Hero, Content, Footer) is **dead code** — the `(public)/page.tsx` route
group takes precedence for `/`, so poly actually renders the operator's homepage
(NewHomeHero + HomeStats from `src/app/(public)/page.tsx`).

**Resy (:3300):** Homepage at `src/app/(public)/page.tsx:16` redirects logged-in
users to `/chat`. Sign-in from the landing page hero uses the same broken
`/api/auth/signin` link pattern (inherited from operator's NewHomeHero
which uses `useTryDemo` — but resy's fork-specific homepage doesn't).

### Expected

All node landing pages use the same auth flow as operator:

- Button opens RainbowKit connect modal (wallet + OAuth options)
- On auth success, redirect to `/chat`
- Operator uses `useTryDemo` hook at `apps/operator/src/features/home/hooks/useTryDemo.ts`
  which calls `openConnectModal()` / `openAccountModal()` from `@rainbow-me/rainbowkit`

### Root cause

1. `nodes/poly/app/src/components/Header.tsx:53` and `Hero.tsx:118` use
   `href="/api/auth/signin"` — wrong pattern, should use client-side modal
2. Poly's `src/app/page.tsx` (custom landing) is shadowed by `src/app/(public)/page.tsx`
3. Operator's `useTryDemo` hook is available in both nodes (copied from template)
   but not wired into the landing page CTAs

### Impact

Users cannot sign in from poly or resy landing pages. Must navigate to `/chat`
directly to trigger the auth redirect.

## Allowed Changes

- `nodes/poly/app/src/app/(public)/page.tsx` — render poly's custom landing
- `nodes/poly/app/src/components/Header.tsx` — client-side auth
- `nodes/poly/app/src/components/Hero.tsx` — client-side auth
- `nodes/resy/app/src/app/(public)/page.tsx` — client-side auth
- `nodes/resy/app/src/features/home/` — wire useTryDemo or equivalent

## Plan

- [ ] Poly: move custom landing content into `(public)/page.tsx` or remove route group override
- [ ] Replace `/api/auth/signin` hrefs with `useTryDemo` hook (already in codebase)
- [ ] Verify auth flow on poly (:3100) and resy (:3300)

## Validation

**Manual:**

1. Visit http://localhost:3100 — sign-in button opens wallet/OAuth dialog
2. Visit http://localhost:3300 — sign-in button opens wallet/OAuth dialog
3. Complete auth → redirect to /chat on both

## Review Checklist

- [ ] **Work Item:** `bug.0255` linked in PR body
- [ ] **Spec:** auth flow matches operator pattern
- [ ] **Tests:** manual validation on all three ports
- [ ] **Reviewer:** assigned and approved
