---
id: bug.0025.handoff
type: handoff
work_item_id: bug.0025
status: active
created: 2026-02-12
updated: 2026-02-12
branch: bug/0025-preflight-credit-check
last_commit: fdf0625a
---

# Handoff: Preflight Credit Check — Decorator + Schedule Gate

## Context

- Preflight credit checks were only enforced in the facade (`completion.server.ts`), leaving internal routes and scheduled runs ungated
- Same structural class as task.0007 (billing enforcement): fix is a decorator at `GraphExecutorPort` so all execution paths are covered
- Two-part fix: (1) `PreflightCreditCheckDecorator` at the execution port, (2) coarse balance check in `POST /api/v1/schedules`
- Work item: [`bug.0025`](../items/bug.0025.schedule-creation-no-credit-gate.md)
- Parent project: [`proj.unified-graph-launch`](../projects/proj.unified-graph-launch.md)

## Current State

- **Implementation complete** across 4 commits on `bug/0025-preflight-credit-check`
- `pnpm check` passes (typecheck, lint, format, arch, docs)
- `pnpm test` passes (910 tests, 0 failures, including 3 new decorator unit tests)
- **Contract tests written and passing** — 4 tests in `tests/contract/app/schedules.credit-gate.test.ts`
- Worktree at `/Users/derek/dev/cogni-template-worktrees/bug-0025-preflight-credit-check`
- AGENTS.md in `src/adapters/server/ai/` updated with new decorator export

## Decisions Made

- **Decorator stack order**: Observability (outer) → Preflight → Billing → Aggregator (inner). Observability traces preflight failures; billing never fires for rejected runs.
- **`PreflightCreditCheckFn` lives in `ports/graph-executor.port.ts`** — `types/` is a leaf layer (can only import itself); ports can import `Message` from core.
- **DI callback pattern**: Decorator receives injected `PreflightCreditCheckFn` (same pattern as `BillingCommitFn`). Closures created in app layer (facade + internal route), since bootstrap cannot import features.
- **`preflightCreditCheck` stays in `public.server.ts`** barrel — dep-cruiser rule `no-ai-facades-to-feature-services` blocks direct service imports from facades. Export annotated as DI-closure-only. Internal route imports directly from service file (allowed).
- **Eager check start**: `checkFn` fires when `runGraph()` is called (not lazily on first stream iteration). Both stream and result promise observe the same check promise.
- **Schedule gate is coarse**: paid model + balance <= 0 → 402. No token estimation.

## Next Actions

- [x] Write contract test: schedule creation with paid model + zero credits → 402
- [x] Write contract test: schedule creation with free model + zero credits → 201
- [x] Update `src/adapters/server/ai/AGENTS.md` exports list to include `PreflightCreditCheckDecorator`
- [ ] Create PR targeting `staging`
- [ ] Update `bug.0025` status to Done after merge

## Risks / Gotchas

- **Hanging result promise on preflight rejection**: When credit check fails, inner stream is never consumed, so inner result promise may never settle. Observability decorator's 15s finalization timer handles this as `finalization_lost`. Acceptable for P0.
- **Barrel bypass vector**: `preflightCreditCheck` in `public.server.ts` is documented as DI-closure-only but not enforced. A future caller could import and call it directly, re-introducing facade-level enforcement drift.
- **Schedule gate is creation-time only**: Credits may deplete between schedule creation and execution. The decorator catches this at execution time.
- **`isModelFree()` safe default**: Returns `false` on catalog unavailability (treats as paid). A catalog outage could block free-model schedule creation with a 402.

## Pointers

| File / Resource                                                          | Why it matters                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| `src/adapters/server/ai/preflight-credit-check.decorator.ts`             | New decorator (core change)                         |
| `src/ports/graph-executor.port.ts`                                       | `PreflightCreditCheckFn` type definition            |
| `src/bootstrap/graph-executor.factory.ts`                                | Decorator stack wiring                              |
| `src/app/_facades/ai/completion.server.ts`                               | Facade — preflight closure, removed old direct call |
| `src/app/api/internal/graphs/[graphId]/runs/route.ts`                    | Internal route — now credit-gated via decorator     |
| `src/app/api/v1/schedules/route.ts`                                      | Schedule creation coarse gate (lines 132-142)       |
| `tests/contract/app/ai.chat.paid-model-zero-credits.test.ts`             | Pattern to follow for schedule contract tests       |
| `tests/unit/adapters/server/ai/preflight-credit-check.decorator.test.ts` | Decorator unit tests                                |
| `work/items/bug.0025.schedule-creation-no-credit-gate.md`                | Canonical work item                                 |
