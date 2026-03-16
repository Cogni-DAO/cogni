---
id: task.0111.handoff
type: handoff
work_item_id: task.0111
status: active
created: 2026-02-28
updated: 2026-02-28
branch: feat/oauth-signin
last_commit: adce4194
---

# Handoff: Auth UX — Sign-In Dialog + Profile Linking

## Context

- task.0111 adds a unified sign-in entrypoint and profile account-linking UX
- Original spec called for a standalone `/sign-in` page + middleware guards; **design was changed** to a modal dialog triggered from the existing "Connect" button instead (no new route group, no middleware)
- The profile page was a static mockup — needed real data from `/api/v1/users/me` and wiring to `/api/auth/link/{provider}`
- Duplicate SVG icons (Ethereum, GitHub, Discord, Google) existed in 3+ files; extracted to shared component
- See plan file: `.claude/plans/cozy-stargazing-acorn.md` for the approved design + footgun analysis

## Current State

- **Done:** SignInDialog component, ProviderIcons shared component, WalletConnectButton integration, profile page wired with real data + dynamic provider discovery + link buttons + feedback banners, footer/avatar icon dedup, link endpoint callbackUrl, auth.ts conflict handling (`?error=already_linked`), session rotation resilience in `[...nextauth]` route
- **Done but needs revert:** Hacky redirect-loop "fix" in `AuthRedirect.tsx` and `(app)/layout.tsx` using refs — **should be reverted** and replaced with proper server-side route protection (see Next Actions)
- **Not done:** Middleware (`src/middleware.ts`) — deferred in plan but is the real fix for the redirect loop
- **Not done:** `docs/guides/oauth-app-setup.md` has a prettier formatting fix staged that's unrelated
- **Bug (blocking commit):** Redirect loop between `/` ↔ `/chat` — `AuthRedirect` (public) and `(app)/layout` do dueling `useSession()` redirects; session status flickers during SIWE completion and link callbacks
- **Note:** Env vars were renamed to `*_OAUTH_*` pattern by another dev during this session — verify `auth.ts` provider registration matches current env var names

## Decisions Made

- Modal dialog instead of `/sign-in` page — approved in plan review (`.claude/plans/cozy-stargazing-acorn.md`)
- `<a href>` tags for link buttons instead of `window.location.href` — full navigation needed for cookie-setting endpoint
- Profile page and SignInDialog both fetch `/api/auth/providers` at runtime to dynamically show only configured providers
- Link conflict returns redirect URL (`/profile?error=already_linked`) instead of `return false` from signIn callback — prevents NextAuth error page
- Query params (`?linked`, `?error`) stripped via `router.replace("/profile")` after displaying feedback banner

## Next Actions

- [ ] **Revert ref-based redirect guards** in `src/app/(public)/AuthRedirect.tsx` and `src/app/(app)/layout.tsx` — these are band-aids
- [ ] **Fix redirect loop properly:** either (a) create `src/middleware.ts` to enforce auth server-side before render, or (b) convert `AuthRedirect` to a server component that reads session and calls `redirect("/chat")` — eliminate dueling client-side `useSession()` redirects
- [ ] **Verify env var names** — another dev renamed OAuth env vars to `*_OAUTH_*` pattern; ensure `src/auth.ts` provider registration (lines 203-226) matches
- [ ] **SIWE fallback testing** — verify that the "Sign message" button state in WalletConnectButton (`authenticationStatus === "unauthenticated"` with `account` present) actually works; may need to call `openConnectModal()` or a different RainbowKit method
- [ ] Add error handling for profile fetch/save failures (currently silent catch)
- [ ] Run `pnpm check` — should pass cleanly once redirect loop fix is proper
- [ ] Manual smoke test all 7 scenarios from plan verification section

## Risks / Gotchas

- **Redirect loop is the blocker** — don't commit until the dueling-redirect architecture is fixed server-side; the ref guards mask the problem
- Session rotation between link-start and OAuth-callback could strand users — `[...nextauth]/route.ts` now accepts link_intent if session token exists (even if hash doesn't match), relying on signed JWT cookie security; review whether this weakens the threat model
- `RainbowKitSiweNextAuthProvider` auto-triggering SIWE after wallet connect is an assumption — needs manual verification; if unreliable, the "Sign message" fallback button is the safety net
- Another dev's stashed files (`git stash list` — "other-dev: x402 docs + research") need to be popped back
- The `OAUTH_PROVIDERS` array in profile page is static metadata (icon, label) — provider _availability_ is dynamic via fetch, but if a new provider is added server-side, it also needs a row in this array

## Pointers

| File / Resource                                          | Why it matters                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/components/kit/auth/SignInDialog.tsx`               | New sign-in modal — fetches providers, renders wallet + OAuth buttons  |
| `src/components/kit/auth/WalletConnectButton.tsx`        | Modified to open SignInDialog; has SIWE fallback state                 |
| `src/components/kit/data-display/ProviderIcons.tsx`      | Shared SVG icons (Ethereum, GitHub, Discord, Google)                   |
| `src/app/(app)/profile/page.tsx`                         | Wired with real data, dynamic providers, link buttons, feedback banner |
| `src/app/(public)/AuthRedirect.tsx`                      | **Source of redirect loop** — needs server-side replacement            |
| `src/app/(app)/layout.tsx`                               | **Other side of redirect loop** — client auth guard                    |
| `src/app/api/auth/link/[provider]/route.ts`              | Link initiation — now passes `callbackUrl=/profile?linked={provider}`  |
| `src/app/api/auth/[...nextauth]/route.ts`                | Link-intent cookie verification — session rotation fallback added      |
| `src/auth.ts`                                            | signIn callback — link conflict returns redirect URL not `false`       |
| `.claude/plans/cozy-stargazing-acorn.md`                 | Approved plan with footgun analysis                                    |
| `work/items/task.0111.auth-ux-signin-linking-profile.md` | Original work item spec (note: design diverged from spec)              |
