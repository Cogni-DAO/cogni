---
id: task.0266
type: task
title: "Mobile OAuth auth — GitHub/Discord/Google via expo-auth-session"
status: needs_implement
priority: 2
rank: 3
estimate: 2
summary: "Implement OAuth login flows on mobile using expo-auth-session. Store JWT in SecureStore. Protected route guard redirects unauthenticated users."
outcome: "Users can sign in via GitHub, Discord, or Google on the mobile app. JWT persisted securely. Auth state survives app restart."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0265]
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
---

# Mobile OAuth auth — GitHub/Discord/Google via expo-auth-session

## Goal

OAuth login on mobile, matching the web app's NextAuth JWT strategy. Mobile POSTs OAuth credentials to the backend, receives a JWT, stores it in SecureStore.

## Implementation Plan

- [ ] Install `expo-auth-session`, `expo-web-browser`, `expo-secure-store`
- [ ] Implement GitHub OAuth flow (authorization URL → code exchange → JWT)
- [ ] Implement Discord and Google OAuth flows (same pattern)
- [ ] Store JWT in `expo-secure-store` (encrypted device storage)
- [ ] Create `useAuth()` hook: `{ user, token, signIn, signOut, isLoading }`
- [ ] Create `AuthGuard` component wrapping `(app)` layout — redirects to login if no token
- [ ] Add Authorization header to all API requests via shared fetch wrapper
- [ ] Handle token refresh / expiry (30-day JWT, re-auth on 401)

## Validation

```bash
# Manual: sign in with GitHub on Expo Go, verify JWT stored, API calls authenticated
pnpm check:fast  # ensure no workspace-level breakage
```
