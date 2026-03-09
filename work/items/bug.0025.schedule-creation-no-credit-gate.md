---
id: bug.0025
type: bug
title: Schedule creation accepts paid agents with zero credits — no preflight credit gate
status: done
priority: 0
estimate: 2
summary: POST /api/v1/schedules creates a schedule (grant + DB + Temporal job) for a paid model without checking the user's credit balance. Users with zero credits can create schedules that will repeatedly fail at execution time.
outcome: Schedule creation for paid models rejects with 402 when user has insufficient credits, matching interactive chat behavior.
spec_refs: scheduler, graph-execution
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch: bug/0025-preflight-credit-check
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-13
labels: [billing, scheduler]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Schedule creation accepts paid agents with zero credits — no preflight credit gate

## Requirements

### Observed

`POST /api/v1/schedules` (`src/app/api/v1/schedules/route.ts:102-160`) creates a schedule without any credit balance check. The route:

1. Parses input and validates cron/timezone
2. Gets or creates a billing account (`route.ts:125-130`)
3. Calls `scheduleManager.createSchedule()` which creates a grant + DB row + Temporal schedule (`packages/db-client/src/adapters/drizzle-schedule.adapter.ts:109-167`)

**No credit check occurs at any layer** — not in the route, not in the schedule manager port, not in the adapter.

The UI model picker (`src/app/(app)/schedules/view.tsx:296-313`) renders all models (paid and free) without any credit-based filtering or warning.

When the schedule fires, the Temporal workflow (`services/scheduler-worker/src/workflows/scheduled-run.workflow.ts:81-161`) validates the _grant_ (authorization) but never checks _credit balance_ (funds). The `executeGraphActivity` calls the internal API which also has no credit pre-check (this is the same gap noted in `bug.0005`).

### Expected

Schedule creation for paid models should fail with 402 (or equivalent) when the user has zero credits, consistent with interactive chat behavior.

Interactive chat (`src/app/_facades/ai/completion.server.ts:216`) calls `preflightCreditCheck()` (`src/features/ai/services/preflight-credit-check.ts:111-127`) **before** graph execution. This function:

- Estimates token cost via `estimateTotalTokens()` + `GRAPH_OVERHEAD_BUFFER`
- Checks balance via `accountService.getBalance()`
- Throws `InsufficientCreditsPortError` if insufficient

Schedule creation should have an analogous gate.

### Reproduction

1. Create a user account with zero credits (or exhaust existing credits)
2. Navigate to `/schedules`
3. Select a paid agent and paid model (e.g., `gpt-4o-mini`)
4. Enter any prompt, select a cron schedule
5. Click "Create Schedule"
6. **Result**: Schedule is created successfully (201 response)
7. **Expected**: 402 Payment Required or equivalent error

### Impact

- **User confusion**: Schedules are created but will silently fail at execution time (or accumulate debt)
- **Resource waste**: Temporal schedules, execution grants, and DB rows are created for runs that can never succeed
- **Billing inconsistency**: Interactive chat enforces preflight credit check; schedules do not — same action, different enforcement

## Allowed Changes

- `src/app/api/v1/schedules/route.ts` — add credit pre-check before `createSchedule()`
- `src/app/(app)/schedules/view.tsx` — optionally gate paid model selection based on credit balance
- `tests/contract/` or `tests/stack/` — add test for schedule creation with zero credits on paid model
- Scheduler spec (`docs/spec/scheduler.md`) — add invariant documenting credit pre-check requirement

## Plan

### Step 1: PreflightCreditCheckDecorator (execution-port enforcement)

- [x] Create `PreflightCreditCheckDecorator` at `src/adapters/server/ai/preflight-credit-check.decorator.ts`
- [x] Define `PreflightCreditCheckFn` callback type in `src/ports/graph-executor.port.ts`
- [x] Wire decorator into stack: Observability → **Preflight** → Billing → Aggregator (`graph-executor.factory.ts`)
- [x] Remove facade-level `preflightCreditCheck()` call from `completion.server.ts`
- [x] Add preflight closure to internal graphs route (`/api/internal/graphs/*/runs`)
- [x] Remove `preflightCreditCheck` from `features/ai/public.server.ts` barrel (documented as DI closure source only)

### Step 2: Schedule creation gate (route-level)

- [x] In `POST /api/v1/schedules`, extract model from `input.input.model`
- [x] Call `isModelFree()` — skip for free models
- [x] For paid models, `accountService.getBalance()` ≤ 0 → 402

### Step 3: Tests & validation

- [x] Unit test: `tests/unit/adapters/server/ai/preflight-credit-check.decorator.test.ts`
- [x] `pnpm check` — all pass
- [x] `pnpm test` — 910 tests pass
- [x] Add contract test: schedule creation with paid model + zero credits → 402
- [x] Add contract test: schedule creation with free model + zero credits → 201 (succeeds)

## Validation

**Command:**

```bash
pnpm check
pnpm test path/to/schedule-credit-gate.test.ts
```

**Expected:** All tests pass. Paid model + zero credits = 402. Free model + zero credits = 201.

## Review Checklist

- [ ] **Work Item:** `bug.0025` linked in PR body
- [ ] **Spec:** Billing enforcement parity between interactive and scheduled paths
- [ ] **Tests:** Contract test covers paid model + zero credits rejection
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/bug.0025.handoff.md)

## Attribution

-
