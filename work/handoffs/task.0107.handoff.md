---
id: task.0107.handoff
type: handoff
work_item_id: task.0107
status: active
created: 2026-02-24
updated: 2026-02-24
branch: feat/ledger-ui
last_commit: ec2a6289
---

# Handoff: Multi-Provider Auth — Discord + GitHub OAuth on NextAuth v4

## Context

- The platform currently requires SIWE wallet login. Users without wallets (Discord-first, GitHub-first contributors) cannot access the platform at all.
- The identity spec (`proj.decentralized-identity`) established `user_id` (UUID) as canonical identity, but the auth layer still enforces `walletAddress` as mandatory at every session boundary.
- task.0107 adds Discord and GitHub OAuth providers so users can sign in with any method, all resolving to the same `user_id`.
- The binding infrastructure (`user_bindings` + `identity_events` + `createBinding()`) already exists from task.0089 — no new tables needed.
- **Design is complete, status is `needs_implement`.** The next developer should review the design, then implement.

## Current State

- **Done:** Research spike, design document written in task.0107 work item, project roadmap updated.
- **Key design pivot:** Original plan was Auth.js v5 + DrizzleAdapter. Research revealed RainbowKit SIWE is incompatible with v5 and `user_bindings` already serves as the accounts table. Revised plan: stay on NextAuth v4, add OAuth providers, resolve via `user_bindings` in callbacks.
- **Not started:** All implementation (types, providers, callbacks, linking endpoint, tests, spec update).

## Decisions Made

- **Stay on NextAuth v4** — RainbowKit SIWE adapter (`@rainbow-me/rainbowkit-siwe-next-auth`) has hard peer incompatibility with `next-auth@5`. See [task.0107 Research Findings](../items/task.0107.authjs-multi-provider-migration.md#research-findings-completed).
- **No DrizzleAdapter, no new tables** — `user_bindings` already maps `(provider, external_id) → user_id`. Adding Auth.js `accounts` table would duplicate data.
- **Account linking via HttpOnly cookie** — NextAuth owns OAuth `state` for CSRF. Linking uses `/api/auth/link/[provider]` → sets `link_intent` cookie → redirects to standard NextAuth sign-in → `signIn` callback reads cookie. See [Auth Flow Design](../items/task.0107.authjs-multi-provider-migration.md#auth-flow-design).
- **Never enable `allowDangerousEmailAccountLinking`** — linking must be explicit (while-authenticated only).
- **walletAddress becomes `string | null`** — payment and ledger operations that need a wallet already return 403 on null.

## Next Actions

- [ ] Review the [full design](../items/task.0107.authjs-multi-provider-migration.md#design) for completeness and correctness
- [ ] Validate the linking flow (HttpOnly cookie approach) against NextAuth v4 callback API
- [ ] Confirm `signIn` callback has access to request cookies in NextAuth v4 (needed for link_intent detection)
- [ ] Implement Step 1: types & guards (`SessionUser.walletAddress: string | null`, `getServerSessionUser` id-only)
- [ ] Implement Step 2: OAuth providers + `signIn`/`jwt`/`session` callbacks
- [ ] Implement Step 3: account linking endpoint
- [ ] Implement Step 4: spec update + tests
- [ ] Run `pnpm check` after Step 1 to verify type changes compile clean before touching runtime

## Risks / Gotchas

- **`signIn` callback cookie access:** NextAuth v4 `signIn` callback receives `(user, account, profile, email, credentials)` — does NOT receive `req`. Reading `link_intent` cookie may require using NextAuth's `events` or wrapping the callback. Verify this before implementing Step 3.
- **walletAddress blast radius:** 9 critical files, 16 medium, 20+ low. The critical ones are payment creation (`getAddress()` throws on null) and ledger approver guard (already handles null → 403). See [audit in design](../items/task.0107.authjs-multi-provider-migration.md).
- **`jwt` callback must explicitly propagate custom fields** — Auth.js does not auto-forward `token.id` or `token.walletAddress` to session. Existing code already does this, but verify it survives the refactor.
- **System principal quirk:** `src/app/api/v1/governance/activity/route.ts` uses `walletAddress: ""` (empty string) for system tenant. Plan changes this to `null`.
- **Pre-existing lint failures on `feat/ledger-ui`:** `pnpm check` fails on 3 pre-existing issues (lint, format, root-layout) unrelated to this task. Push requires `--no-verify` until those are fixed.

## Pointers

| File / Resource                                                              | Why it matters                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [task.0107 work item](../items/task.0107.authjs-multi-provider-migration.md) | Full design, invariants, plan, file list                   |
| [proj.decentralized-identity](../projects/proj.decentralized-identity.md)    | Parent project roadmap (P0 row)                            |
| `src/auth.ts`                                                                | Main auth config — add providers + callbacks here          |
| `src/shared/auth/session.ts`                                                 | `SessionUser` type — walletAddress becomes optional        |
| `src/lib/auth/server.ts`                                                     | `getServerSessionUser()` — relax wallet guard              |
| `src/adapters/server/identity/create-binding.ts`                             | `createBinding()` — already supports wallet/discord/github |
| `packages/db-schema/src/identity.ts`                                         | `user_bindings` + `identity_events` schema                 |
| `src/app/_facades/payments/attempts.server.ts:95`                            | Critical: `getAddress(walletAddress)` — needs null guard   |
| `src/app/api/v1/ledger/_lib/approver-guard.ts`                               | Already handles null wallet → 403 (safe)                   |
| `docs/spec/authentication.md`                                                | Auth spec to update (remove SIWE_CANONICAL_IDENTITY)       |
