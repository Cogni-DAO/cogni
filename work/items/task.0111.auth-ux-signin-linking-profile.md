---
id: task.0111
type: task
title: "Auth UX: /sign-in page, middleware guards, account linking buttons, profile polish"
status: needs_implement
priority: 0
rank: 11
estimate: 3
summary: Custom /sign-in page with WalletConnect + OAuth buttons, Next.js middleware for auth routing, "Link Provider" buttons on profile page, SVG provider icons, kit component polish.
outcome: Users sign in via /sign-in (not NextAuth defaults); middleware redirects authed users off /sign-in and unauthed off (app) routes; profile shows linked accounts with link buttons for unlinked providers.
spec_refs: authentication-spec, decentralized-user-identity
assignees: unassigned
credit:
project: proj.decentralized-identity
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-26
updated: 2026-02-26
labels: [identity, auth, frontend]
external_refs:
---

# Auth UX: /sign-in + Middleware + Linking + Profile

## Requirements

### Sign-In Page

- Create `(auth)` route group with centered layout (no sidebar/header/footer).
- `/sign-in` page (client component):
  - Fetches `/api/auth/providers` on mount to discover available OAuth providers.
  - Filters out `credentials` provider.
  - Renders WalletConnect button (SIWE) via RainbowKit `ConnectButton`.
  - Renders OAuth buttons for each available provider: `Button variant="outline"` with provider SVG icon + "Continue with {Name}".
  - OAuth buttons call `signIn(providerId, { callbackUrl: "/chat" })`.
  - Redirects to `/chat` if already authenticated.
- Update `src/auth.ts:55`: `signIn: "/"` → `signIn: "/sign-in"`.

### Middleware Guards

- Create `src/middleware.ts`:
  - Authed users on `/sign-in` → redirect to `/chat`.
  - Unauthed users on `(app)` routes → redirect to `/sign-in`.
  - Use NextAuth JWT token check (lightweight, Edge-compatible).
  - `config.matcher` scoped to relevant routes (skip API, static, `_next`).
- Update `src/app/(app)/layout.tsx:37`: `router.replace("/")` → `router.replace("/sign-in")` (client-side fallback).

### Account Linking on Profile

- Fetch `/api/auth/providers` on profile page mount.
- Compute unlinked providers: `available - linked` (excluding `credentials`).
- Render "Link {Provider}" button for each unlinked provider.
- Button handler: `window.location.href = "/api/auth/link/{provider}"` (full-page nav — endpoint sets cookies + redirects).
- Update `src/app/api/auth/link/[provider]/route.ts` to set `callbackUrl` to `/profile`.

### Profile Polish

- Replace emoji `PROVIDER_ICONS` with SVG components from shared module.
- Create `src/components/kit/data-display/ProviderIcons.tsx` — GitHub, Discord, Google, Eth SVGs. Extract existing inline SVGs from `footer-items.tsx` / `UserAvatarMenu.tsx`.
- Replace raw `<input>` with kit `Input`, raw `<button>` with kit `Button`.
- Wrap sections with `Card`/`CardContent`.
- Show "Connect wallet to enable payments" for OAuth-only users (`walletAddress === null`).

### Error Handling

- Visible error UI (toast or inline) for profile fetch/save failures and link failures.

## Allowed Changes

- `src/app/(auth)/` — new route group (layout + sign-in page)
- `src/middleware.ts` — new file
- `src/auth.ts` — `pages.signIn` value only
- `src/app/(app)/layout.tsx` — redirect target only
- `src/app/(app)/profile/page.tsx` — linking buttons, kit components, SVG icons, error UI
- `src/app/api/auth/link/[provider]/route.ts` — callbackUrl
- `src/components/kit/data-display/ProviderIcons.tsx` — new shared icons
- `src/features/layout/components/footer-items.tsx` — import from shared icons
- `src/features/layout/components/UserAvatarMenu.tsx` — import from shared icons

## Plan

- [ ] Create `src/components/kit/data-display/ProviderIcons.tsx` — GitHub, Discord, Google, Eth SVGs
- [ ] Create `src/app/(auth)/layout.tsx` — centered minimal layout
- [ ] Create `src/app/(auth)/sign-in/page.tsx` — WalletConnect + OAuth buttons
- [ ] Update `src/auth.ts`: `pages.signIn: "/sign-in"`
- [ ] Create `src/middleware.ts` with auth route guards
- [ ] Update `src/app/(app)/layout.tsx`: redirect to `/sign-in`
- [ ] Update link endpoint: set callbackUrl to `/profile`
- [ ] Add "Link {Provider}" buttons to profile page
- [ ] Replace emoji icons + raw HTML with kit components on profile
- [ ] Add "Connect wallet" message for OAuth-only users
- [ ] Add error handling for fetch/save/link failures
- [ ] Update `footer-items.tsx` / `UserAvatarMenu.tsx` to import shared icons
- [ ] Run `pnpm check` + `pnpm test`

## Validation

**Commands:**

```bash
pnpm check            # types + lint clean
pnpm test             # existing tests pass
pnpm check:docs       # docs metadata valid
```

**Manual smoke tests:**

1. `/sign-in` shows wallet connect + OAuth buttons (only configured providers)
2. "Continue with GitHub" → GitHub OAuth → `/chat`
3. Sign out → redirected to `/sign-in`
4. Unauthed user hitting `/chat` → redirected to `/sign-in` (middleware)
5. Authed user hitting `/sign-in` → redirected to `/chat` (middleware)
6. `/profile` shows linked accounts with SVG icons
7. "Link Google" → Google OAuth → back to `/profile` → Google in linked accounts
8. OAuth-only user sees "Connect wallet to enable payments"

## Review Checklist

- [ ] **Work Item:** `task.0111` linked in PR body
- [ ] **Spec:** `pages.signIn` matches authentication spec
- [ ] **Spec:** WALLET_SESSION_COHERENCE unbroken (SIWE still works)
- [ ] **Tests:** middleware redirect logic tested; sign-in page renders correctly
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
