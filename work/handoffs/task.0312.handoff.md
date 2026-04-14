---
id: task.0312.handoff
type: handoff
work_item_id: task.0312
status: active
created: 2026-04-14
updated: 2026-04-14
branch: feat/agent-first-auth-a1
last_commit: a0d8c93f2
---

# Handoff: Agent-first auth A1 — contract lock

## Context

- `task.0312` is the A1 (contract lock) deliverable of the agent-first auth track in `proj.accounts-api-keys`. A2 (`task.0313`) covers the actors table + register hardening; A3+ cover proof-of-possession.
- Governing contract: [`docs/spec/agent-first-auth.md`](../../docs/spec/agent-first-auth.md). Read the Core Invariants section before touching any code — every SCREAMING_SNAKE rule is a hard constraint.
- The design rationale came from an external review saying "empower actorId now, harden credentials in phases." This task locks the handler-facing contract so A2 can swap storage and A3 can swap the proof backend without touching any route file.
- The 7-checkpoint plan lives in `task.0312`'s `## Plan` section. Checkpoints are ordered so the tree stays green at every boundary — the wrapper keeps both legacy and new shapes (overload) during checkpoints 3–6, then the legacy shape is deleted in checkpoint 7.
- The branch is already pushed with 4 commits: 3 design commits (spec + project roadmap + task split) and 1 implementation commit (checkpoint 1).

## Current State

- **Checkpoint 1 of 7 — SHIPPED** ✅. Commit [`a0d8c93f2`](https://github.com/Cogni-DAO/node-template/commit/a0d8c93f2).
  - `AuthPrincipal`, `AuthPolicy`, `PrincipalType` types in `packages/node-shared/src/auth/principal.ts`.
  - Re-exported via `@cogni/node-shared` barrel.
  - Contract test at `packages/node-shared/tests/auth-principal.test.ts` — compile-time `IsExact<...>` asserts + runtime shape checks.
  - `pnpm check:fast` clean (51s typecheck, 191s workspace tests).
- **Checkpoints 2–7 — not started.** No operator/node-template/poly/resy code touches the new types yet.
- **Worktree**: `.worktrees/design-agent-first-auth` is fully provisioned (real `pnpm install --frozen-lockfile` + `pnpm packages:build` already run). Earlier symlink-to-root workaround is replaced.
- **`bug.0297`**: blocked on `task.0313` (A2), not this task. A1 does not affect the severity.

## Decisions Made

- Split the original monolithic task.0312 into A1 (this task) and A2 (`task.0313`) per design review's Scope Discipline finding. See commit `1325a75d4` for the split reasoning.
- Spec stripped of phase/roadmap content per `SPEC_NO_EXEC_PLAN` invariant; roadmap lives in [`proj.accounts-api-keys § Agent-First Auth Track`](../projects/proj.accounts-api-keys.md). See commit `71d7852e6`.
- Wrapper migration strategy: **incremental via overload**, not atomic flag-day. Both `auth: { mode, getSessionUser }` (legacy) and `auth: "authenticated" | "session_only" | "public" | "admin"` (new literal) supported in checkpoints 3–6; legacy deleted in 7.
- `packages/node-shared` is the boundary home for `AuthPrincipal` rather than a new `packages/node-auth`. Rationale documented in `task.0312` rejected alternatives — capability surface is too thin to justify a new package.
- The "extend `SessionUser` in place" alternative was explicitly rejected (same rationale file) because `SessionUser`'s shape is wrong in subtle ways (nullable `userId`, missing `readonly`, UI fields leaking into auth).
- During A1, `actorId` is intentionally a runtime cast over `users.id` with an explicit `TEMPORARY — replaced in A2` comment. Not a hack — it is the A1/A2 seam.

## Next Actions

- [ ] **Checkpoint 2**: Create `nodes/operator/app/src/app/_lib/auth/resolveAuthPrincipal.ts` that returns `AuthPrincipal | null` by wrapping the existing `resolveRequestIdentity` (`@/app/_lib/auth/request-identity.ts`) and `getServerSessionUser` (`@/lib/auth/server.ts`). Handle all 4 policies in one function. Unit tests per the plan.
- [ ] **Checkpoint 3**: Refactor `nodes/operator/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` to accept EITHER the legacy object shape OR the new `auth: AuthPolicy` literal. Dispatch on `typeof auth`. Handler signature correctly typed per policy — `"public"` has no principal arg. Integration test `tests/integration/wrapRouteHandlerWithLogging.int.test.ts` exercising all four paths.
- [ ] **Checkpoint 4**: Flip every `/api/v1/*` route in the operator node to the new `auth: AuthPolicy` literal. Use the bucket rules in the spec. Move `v1/activity` to `"authenticated"`. Grep check: `rg '@/app/_lib/auth/session' nodes/operator/app/src/app/api` must return empty.
- [ ] **Checkpoint 5**: Repeat checkpoints 2–4 for `node-template`, `poly`, `resy` in sequence.
- [ ] **Checkpoint 6**: Add ESLint `no-restricted-imports` rule scoped to `**/app/api/**/route.ts` forbidding `next/headers`, `@/lib/auth/server`, `next-auth`. Write the security test battery at `tests/stack/security/auth-bucket-enforcement.stack.test.ts` per the matrix in `task.0312` Validation section.
- [ ] **Checkpoint 7**: Delete the legacy wrapper overload. Alias `SessionUser = AuthPrincipal` with `@deprecated`. Refresh `docs/guides/agent-api-validation.md`. Run `pnpm check` once (final gate). Update task status to `needs_closeout`.
- [ ] Run `/closeout task.0312` when all checkpoints land.

## Risks / Gotchas

- **Multi-node duplication**: `session.ts` and `request-identity.ts` are copy-pasted across `operator`, `node-template`, `poly`, `resy`. Each node needs its own identical-but-separate refactor. MEMORY.md flags this as a separate cleanup — do NOT de-duplicate them as part of A1.
- **Wrapper overload**: during checkpoints 3–6 the wrapper accepts both shapes. It is tempting to "just flip everything atomic" — don't, the tree must stay green per-checkpoint and a single commit flipping ~50 routes is a hostile diff for reviewers.
- **Cost control**: Opus 4.6 is expensive (see MEMORY.md). The remaining work is mostly mechanical route-file edits — use Sonnet or Haiku for checkpoints 4 and 5 specifically. Save Opus for checkpoints 3 and 6 where invariant reasoning matters.
- **NO_A2_BLEED invariant**: A1 must not touch the `users` table, the register route's output shape, rate limits, spend caps, or `apiKey` TTL. If you find yourself editing `agent/register/route.ts` beyond updating its handler signature, stop — that belongs to `task.0313`.
- **Pre-commit hook runs `check:fast` on push, not commit**. Doc-header linter (`DH003`, `DH004`, `DH006`, `DH007`) runs on commit — keep Purpose under 400 chars, Scope with a negative clause, Invariants/Notes bullets ≤140 chars each, ≤3 items each.

## Pointers

| File / Resource                                                                                                                                      | Why it matters                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/spec/agent-first-auth.md`](../../docs/spec/agent-first-auth.md)                                                                               | Governing contract. Core Invariants section is the code-review criteria.                                                               |
| [`work/items/task.0312.agent-first-auth-a1.md`](../items/task.0312.agent-first-auth-a1.md)                                                           | Source of truth. `## Plan` has the 7-checkpoint execution list; `## Design` has rejected alternatives.                                 |
| [`work/items/task.0313.agent-first-auth-a2.md`](../items/task.0313.agent-first-auth-a2.md)                                                           | A2 follow-up. Read to understand what this task must NOT do.                                                                           |
| [`work/projects/proj.accounts-api-keys.md`](../projects/proj.accounts-api-keys.md) § "Agent-First Auth Track"                                        | Roadmap with A1→A5 deliverable tables.                                                                                                 |
| [`packages/node-shared/src/auth/principal.ts`](../../packages/node-shared/src/auth/principal.ts)                                                     | The types just landed in checkpoint 1 — consume these.                                                                                 |
| [`packages/node-shared/tests/auth-principal.test.ts`](../../packages/node-shared/tests/auth-principal.test.ts)                                       | Contract test. A regression here means the shape is drifting.                                                                          |
| [`nodes/operator/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts`](../../nodes/operator/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts) | Checkpoint 3 target. 220 lines, already parameterized — you're adding an overload, not rewriting.                                      |
| [`nodes/operator/app/src/app/_lib/auth/request-identity.ts`](../../nodes/operator/app/src/app/_lib/auth/request-identity.ts)                         | `resolveRequestIdentity` is the existing bearer-or-session resolver from PR #845. Reuse inside `resolveAuthPrincipal`; do NOT rewrite. |
| [`docs/guides/agent-api-validation.md`](../../docs/guides/agent-api-validation.md)                                                                   | Stale (mentions shortcomings already fixed by PR #845). Refresh during checkpoint 7.                                                   |
| [`MEMORY.md`](../../../CLAUDE.md) (imported from `~/.claude/projects/.../memory/`)                                                                   | Cost-control rules, check:fast discipline, multi-node duplication notes.                                                               |
