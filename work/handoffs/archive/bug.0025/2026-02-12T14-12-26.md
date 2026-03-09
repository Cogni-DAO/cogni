---
id: bug.0025.handoff
type: handoff
work_item_id: bug.0025
status: active
created: 2026-02-12
updated: 2026-02-12
branch: bug/0025-preflight-credit-check
last_commit: 0fcf31c3
---

# Handoff: Preflight Credit Check Decorator + Schedule Creation Gate

## Context

- Preflight credit checks were only enforced in the facade (`completion.server.ts`) — the internal route and scheduled runs had no credit gate
- This is the same structural class of bug as task.0007 fixed for billing: enforcement must be at the `GraphExecutorPort` decorator level, not in individual callers
- Two fixes: (1) `PreflightCreditCheckDecorator` at the execution port for all paths, (2) coarse balance check in `POST /api/v1/schedules` to reject unpayable schedule creation
- Work item: [`bug.0025`](../items/bug.0025.schedule-creation-no-credit-gate.md)
- Parent project: [`proj.unified-graph-launch`](../projects/proj.unified-graph-launch.md)

## Current State

- **All implementation complete**, all changes uncommitted on worktree branch `bug/0025-preflight-credit-check`
- `pnpm check` passes (typecheck, lint, format, arch, docs)
- `pnpm test` passes (910 tests, 0 failures)
- 3 new unit tests for the decorator pass
- Contract tests for schedule credit gate NOT yet written (see Next Actions)
- Worktree at `/Users/derek/dev/cogni-template-worktrees/bug-0025-preflight-credit-check`

## Decisions Made

- **Decorator position**: Obs (outermost) → Preflight → Billing → Aggregator (innermost). This ensures observability traces preflight failures, and billing never fires for rejected runs.
- **`PreflightCreditCheckFn` lives in `ports/`** (not `types/`), because it depends on `Message` from `core` and `types` is a leaf layer that can only import itself.
- **`preflightCreditCheck` stays in `public.server.ts` barrel** — dep-cruiser rule `no-ai-facades-to-feature-services` blocks direct service imports from facades. Annotated as DI-closure-only. Internal route imports directly from service file (allowed by dep-cruiser).
- **Schedule gate is coarse**: paid model + balance ≤ 0 → 402. No token estimation, no duplicate logic.
- **Eager check start**: `checkFn` runs as soon as `runGraph()` is called (parallel with sync setup), not lazily on first stream iteration. Both stream and final observe the same promise.

## Next Actions

- [ ] Commit all changes on the worktree branch
- [ ] Add contract test: schedule creation with paid model + zero credits → 402
- [ ] Add contract test: schedule creation with free model + zero credits → 201
- [ ] Consider: validate `req.caller.userId` is non-null in decorator (fail-fast invariant)
- [ ] Consider: validate `req.messages` is non-empty before passing to estimator (gateway edge case)
- [ ] Update AGENTS.md in `src/adapters/server/ai/` to list `PreflightCreditCheckDecorator` in exports
- [ ] Create PR targeting `staging`
- [ ] Update `bug.0025` status to Done after merge

## Risks / Gotchas

- **`result.final` may hang if preflight rejects**: When the credit check fails, the inner stream is never consumed, so `inner.final` may never settle. The observability decorator's finalization timer (15s) handles this as `finalization_lost`. Acceptable for P0; may want explicit rejection in P1.
- **`preflightCreditCheck` in barrel is a bypass vector**: It's documented as DI-closure-only, but nothing enforces this. A future caller could import it and call it directly, re-introducing facade-level enforcement drift. Filed note in the barrel comment.
- **Schedule gate checks balance at creation time only**: A user could have credits when creating the schedule but not when it fires. This is intentional — the decorator catches it at execution time.
- **`isModelFree()` is async + cached**: If model catalog is unavailable, `isModelFree()` returns `false` (safe default — treats as paid). This means a catalog outage could block free-model schedule creation.

## Pointers

| File / Resource                                                          | Why it matters                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `src/adapters/server/ai/preflight-credit-check.decorator.ts`             | The new decorator (core change)                      |
| `src/ports/graph-executor.port.ts`                                       | `PreflightCreditCheckFn` type definition             |
| `src/bootstrap/graph-executor.factory.ts`                                | Decorator stack wiring                               |
| `src/app/_facades/ai/completion.server.ts`                               | Facade — creates preflight closure, removed old call |
| `src/app/api/internal/graphs/[graphId]/runs/route.ts`                    | Internal route — now credit-gated via decorator      |
| `src/app/api/v1/schedules/route.ts`                                      | Schedule creation coarse gate (lines 132-142)        |
| `src/features/ai/public.server.ts`                                       | Barrel — preflightCreditCheck annotated as DI-only   |
| `tests/unit/adapters/server/ai/preflight-credit-check.decorator.test.ts` | Unit tests for decorator                             |
| `work/items/bug.0025.schedule-creation-no-credit-gate.md`                | Canonical work item                                  |
| `docs/guides/new-worktree-setup.md`                                      | Worktree setup guide (new)                           |
