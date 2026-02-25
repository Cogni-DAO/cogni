---
id: task.0110
type: task
title: "Profile + identity DB correctness: RLS, constraints, type tightening"
status: needs_merge
priority: 0
rank: 10
estimate: 2
summary: Add RLS to user-owned identity/profile tables, add DB + Zod constraints (displayName max, avatarColor hex), tighten SessionUser types (nullable not optional).
outcome: All user-owned tables have RLS enabled; profile input validated at DB + Zod layers; SessionUser types are strict nullable (not optional); pnpm check clean.
spec_refs: decentralized-user-identity, authentication-spec
assignees: unassigned
credit:
project: proj.decentralized-identity
branch: feat/profile
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-26
updated: 2026-02-26
labels: [identity, auth, security, db]
external_refs:
---

# Profile + Identity DB Correctness

## Requirements

- **RLS enabled** on `user_bindings`, `identity_events`, `user_profiles`, and `user_settings` tables. Currently missing — all other user-owned tables (`users`, `billing_accounts`, `ai_threads`, etc.) already have `.enableRLS()`.
- **DB constraints** added:
  - `display_name` length CHECK on `user_profiles` (max 100 chars).
  - `avatar_color` hex regex CHECK on `user_profiles` (`^#[0-9a-fA-F]{6}$`).
- **Zod contract validation** tightened in `users.profile.v1.contract.ts`:
  - `displayName` input: `.max(100)`.
  - `avatarColor` input: `.regex(/^#[0-9a-fA-F]{6}$/)`.
- **SessionUser type consistency**: `walletAddress` is `string | null` (nullable), never `string | undefined` (optional). Audit `src/types/next-auth.d.ts` and `src/shared/auth/session.ts` for consistency.
- **DB migration** generated for RLS + constraints.
- **No behavioral changes** — pure correctness/hardening.

## Allowed Changes

- `packages/db-schema/src/identity.ts` — `.enableRLS()` on both tables
- `packages/db-schema/src/profile.ts` — `.enableRLS()` on both tables, CHECK constraints
- `packages/db-schema/src/migrations/` — new migration file
- `src/contracts/users.profile.v1.contract.ts` — tighten Zod input schemas
- `src/shared/auth/session.ts` — tighten `walletAddress` nullability if needed
- `src/types/next-auth.d.ts` — align with session type if needed
- `src/auth.ts` — only if type casts need alignment

## Plan

- [ ] **Checkpoint 1 — Schema changes (RLS + CHECK constraints)**
  - Milestone: All user-owned identity/profile tables have `.enableRLS()` and CHECK constraints
  - Note: `userSettings` was pruned — only `userProfiles` in profile.ts
  - Todos:
    - [ ] Add `.enableRLS()` to `userBindings` and `identityEvents` in `packages/db-schema/src/identity.ts`
    - [ ] Add `.enableRLS()` to `userProfiles` in `packages/db-schema/src/profile.ts`
    - [ ] Add `display_name` length CHECK (max 100) and `avatar_color` hex CHECK to `userProfiles`
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2 — Migration generation**
  - Milestone: New migration file generated for RLS + constraints
  - Todos:
    - [ ] Run `pnpm db:generate` to create migration
    - [ ] Verify migration SQL is correct
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 3 — Zod + type tightening**
  - Milestone: Contract inputs validated; SessionUser types consistent
  - Todos:
    - [ ] Tighten Zod contract: `displayName.max(100)`, `avatarColor.regex(/^#[0-9a-fA-F]{6}$/)`
    - [ ] Audit `SessionUser` across `session.ts`, `next-auth.d.ts`, `auth.ts` — ensure `string | null` (not optional)
  - Validation: `pnpm check` + `pnpm test` pass

## Validation

**Commands:**

```bash
pnpm db:generate      # migration generated
pnpm check            # types + lint clean
pnpm test             # existing tests pass
pnpm check:docs       # docs metadata valid
```

**Expected:** All pass. New migration file in `packages/db-schema/src/migrations/`. No behavioral changes.

## Review Checklist

- [ ] **Work Item:** `task.0110` linked in PR body
- [ ] **Spec:** RLS additions consistent with existing `refs.ts` / `billing.ts` patterns
- [ ] **Spec:** Constraints match `decentralized-user-identity` schema section
- [ ] **Tests:** Existing auth + profile tests pass (no new tests needed — pure constraint work)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
