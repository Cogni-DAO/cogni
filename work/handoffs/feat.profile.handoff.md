---
id: "feat.profile.handoff"
type: handoff
work_item_id: "feat.profile"
status: active
created: 2026-02-25
updated: 2026-02-26
branch: "feat/profile"
last_commit: "1be001ec"
---

# Handoff: Profile Feature — Auth, Schema, UI Scaffolding

## Context

- This branch adds user profile infrastructure to the Cogni platform: display name, avatar color, linked account display
- Auth is wallet (SIWE) + OAuth providers (GitHub, Discord, Google) — no email/password
- Parent project: `proj.decentralized-identity` — 3 follow-up tasks created (task.0110, task.0111, task.0112)
- Builds on `feat/opencollect-ui` (#482) which added sidebar layout, tables, mobile polish
- Reference UI: OpenCollective frontend patterns

## Current State

- **Committed and clean** — 11 commits ahead of staging, `pnpm check` passes, working tree clean
- **Profile page** (`src/app/(app)/profile/page.tsx`) — flat settings layout with SVG provider icons, color picker, display name field. Currently static/scaffolded (hardcoded "derekg" display name, no fetch/save wiring to API yet)
- **UserAvatarMenu** — dropdown in AppTopBar with avatar, profile link, sign out, 3-way theme toggle. Uses session `displayName`/`avatarColor`
- **API endpoint** `/api/v1/users/me` — GET (read profile + fallback display name) and PATCH (upsert display name/avatar color). Contract-validated.
- **Schema** — `user_profiles` table defined (no migration yet), `providerLogin` column added to `user_bindings`
- **Auth** — JWT/session callbacks cache `displayName`/`avatarColor` from DB. Empty profile row created on new user signup (both SIWE and OAuth). Provider login captured on OAuth sign-in.
- **Footer** — brand SVGs for GitHub/Discord, restructured bottom bar
- **Scope-creep stripped** — `providerAvatarUrl`, `isPrimary`, `lastUsedAt` columns removed. `userSettings` table pruned (dead code).
- **No migration generated** — deferred to task.0110 which will also add RLS + constraints

## Decisions Made

- Display name fallback: `profile.displayName` → any binding `providerLogin` → wallet truncation → "Anonymous"
- `isPrimary` binding concept deferred — fallback uses first binding with a login, not a "primary" flag
- Theme stored client-side (next-themes localStorage), NOT in DB — `userSettings` table deleted
- Avatar color is a hex string from a 12-color preset palette; validation deferred to task.0110
- Profile page uses inline `style` for dynamic hex colors (color swatches) — Tailwind can't generate classes for runtime values

## Next Actions

- [ ] **task.0110**: Add `.enableRLS()` to `userProfiles`/`userBindings`/`identityEvents`, add Zod + DB constraints (`displayName` max length, `avatarColor` hex regex), tighten `SessionUser` types (`string | null` not optional), generate migration
- [ ] **task.0111**: Custom `/sign-in` page, middleware auth guards, "Link Provider" buttons on profile page, wire profile page to API (fetch/save)
- [ ] **task.0112**: Fix SIWE post-sign-in flash (homepage briefly visible before redirect to `/chat`). Blocked by task.0111.
- [ ] Wire profile page to `/api/v1/users/me` (currently static scaffold)
- [ ] Unify `truncateWallet` — two implementations with different lengths (facade: 6+4, menu: 4+3)
- [ ] Align client/server display name fallback (menu uses `user.name` from NextAuth, facade uses `providerLogin`)

## Risks / Gotchas

- **No migration exists** — `user_profiles` table and `provider_login` column are schema-only. App will crash on profile API calls until migration is generated (task.0110)
- **Display name fallback divergence** — `UserAvatarMenu` uses `session.user.name` (OAuth display name) while the server facade uses `providerLogin` (OAuth username). Can produce different values for the same user.
- **SIWE profile row creation is not atomic** with user row creation (separate try/catch). OAuth path is atomic (transaction). Task.0110 should fix.
- **Profile page `style` props** — needed for dynamic hex colors but flagged in review. Accepted tradeoff.

## Pointers

| File / Resource                                           | Why it matters                                       |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `src/app/(app)/profile/page.tsx`                          | Profile page — static scaffold, needs API wiring     |
| `src/features/layout/components/UserAvatarMenu.tsx`       | Avatar dropdown — display name fallback logic        |
| `src/app/_facades/users/profile.server.ts`                | Server facade — `resolveDisplayName` fallback chain  |
| `src/app/api/v1/users/me/route.ts`                        | GET/PATCH profile endpoint                           |
| `src/contracts/users.profile.v1.contract.ts`              | Zod contract — source of truth for API shapes        |
| `packages/db-schema/src/profile.ts`                       | `userProfiles` table definition (no migration yet)   |
| `src/auth.ts`                                             | JWT/session profile caching, provider login capture  |
| `work/items/task.0110.profile-identity-db-correctness.md` | DB correctness task (RLS, constraints, migration)    |
| `work/items/task.0111.auth-ux-signin-linking-profile.md`  | Auth UX task (sign-in page, linking, profile wiring) |
| `work/items/task.0112.siwe-zero-flash-route-guards.md`    | SIWE redirect flash fix                              |
